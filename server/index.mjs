// Mock dispatch server: node:http and nothing else. Enough to demonstrate every
// acceptance scenario on a real phone, small enough to read in one sitting.
//
// The position payload is the plugin's wire format, which is snake_case:
//   { client_id, lat, lng, accuracy, speed, heading, altitude, recorded_at, heartbeat }
// `client_id` is the de-duplication key — a batch replayed after a tunnel must
// not create a second row.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8788);

/** Bumped by /api/dev/expire-token: every issued access token dies, refresh still works. */
let epoch = 1;
const seen = new Set();
/**
 * Dernières positions par chauffeur. Bornée : une trace qui grandit sans fin
 * finit par tuer le serveur, et un dispatch n'a jamais besoin de tout l'historique
 * en mémoire — ça, c'est le travail d'une base.
 */
const tracks = new Map();
const TRAIL_MAX = 50;
const jobs = new Map();
const trips = [];
let armed = null;
/** Pending timer for a delayed arm, so a second schedule replaces the first. */
let scheduled = null;
let activeJobId = null;
let shiftId = null;
let positions = 0;
let duplicates = 0;

const driver = { id: 'd1', name: 'Riadh F.', phone: '+21600000000' };

const PLACES = [
  { label: 'Lac 2, Tunis', latitude: 36.8352, longitude: 10.2745 },
  { label: 'Avenue Habib Bourguiba', latitude: 36.7996, longitude: 10.1817 },
  { label: 'Aéroport Tunis-Carthage', latitude: 36.851, longitude: 10.2272 },
  { label: 'La Marsa', latitude: 36.8783, longitude: 10.3247 },
];

const json = (res, status, body) => {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

const body = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

/** Le point envoyé par le plugin ne porte pas d'identité : elle vient du token. */
function driverFromAuth(req) {
  const [kind, tokenEpoch, id] = String(req.headers.authorization ?? '')
    .replace(/^Bearer\s+/, '')
    .split('.');
  if (kind !== 'a' || Number(tokenEpoch) !== epoch || !id) return null;
  return id;
}

const authed = (req) => driverFromAuth(req) !== null;

function record(point, driverId) {
  const id = point?.client_id;
  if (!id) return false;
  if (seen.has(id)) {
    duplicates += 1;
    return false;
  }
  seen.add(id);
  positions += 1;

  const fix = {
    clientId: id,
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    speed: point.speed,
    heading: point.heading,
    altitude: point.altitude,
    recordedAt: point.recorded_at,
    heartbeat: Boolean(point.heartbeat),
    receivedAt: Date.now(),
  };
  const track = tracks.get(driverId) ?? { last: null, trail: [] };
  track.last = fix;
  track.trail.push(fix);
  if (track.trail.length > TRAIL_MAX) track.trail.splice(0, track.trail.length - TRAIL_MAX);
  tracks.set(driverId, track);
  return true;
}

function armOffer(ttl) {
  const pickup = PLACES[Math.floor(Math.random() * PLACES.length)];
  let dropoff = PLACES[Math.floor(Math.random() * PLACES.length)];
  if (dropoff === pickup) dropoff = PLACES[(PLACES.indexOf(pickup) + 1) % PLACES.length];
  const job = {
    id: String(1000 + jobs.size + 1),
    customer: 'Amine B.',
    pickup,
    dropoff,
    distanceKm: Number((2 + Math.random() * 8).toFixed(1)),
    fare: Math.round(6 + Math.random() * 18),
    step: null,
  };
  jobs.set(job.id, job);
  armed = { jobId: job.id, ttl, expiresAt: Date.now() + ttl * 1000, sentTo: new Set() };
  log(`offre ${job.id} armée, ttl ${ttl} s — elle partira sur la prochaine position`);
  return job;
}

/** Handed to a device once: a re-triggered alert on every POST would ring forever. */
function alertFor(token) {
  if (!armed) return null;
  if (Date.now() > armed.expiresAt) {
    armed = null;
    return null;
  }
  if (armed.sentTo.has(token) || activeJobId) return null;
  armed.sentTo.add(token);
  const job = jobs.get(armed.jobId);
  return {
    title: 'Nouvelle course',
    body: `${job.distanceKm} km — ${job.fare} DT`,
    data: {
      jobId: job.id,
      ttl: armed.ttl,
      customer: job.customer,
      pickup: job.pickup,
      dropoff: job.dropoff,
      fare: job.fare,
      distanceKm: job.distanceKm,
    },
  };
}

const routes = {
  'POST /api/auth/login': async (req, res) => {
    const { phone } = await body(req);
    json(res, 200, {
      access: `a.${epoch}.${driver.id}`,
      refresh: `r.${driver.id}`,
      driver: { ...driver, phone: phone || driver.phone },
    });
  },

  'POST /api/auth/refresh': async (req, res) => {
    const { refresh } = await body(req);
    if (refresh !== `r.${driver.id}`) return json(res, 401, { reason: 'invalid_refresh' });
    json(res, 200, { access: `a.${epoch}.${driver.id}` });
  },

  'POST /api/positions': async (req, res) => {
    const driverId = driverFromAuth(req);
    if (!driverId) return json(res, 401, { reason: 'expired_access' });
    const point = await body(req);
    const fresh = record(point, driverId);
    log(`position ${fresh ? 'ok' : 'DOUBLON'} total=${positions} doublons=${duplicates}`);
    const alert = alertFor(req.headers.authorization);
    json(res, 200, alert ? { ok: true, alert } : { ok: true });
  },

  'POST /api/positions/batch': async (req, res) => {
    const driverId = driverFromAuth(req);
    if (!driverId) return json(res, 401, { reason: 'expired_access' });
    const { positions: batch = [] } = await body(req);
    const fresh = batch.filter((point) => record(point, driverId)).length;
    log(`lot de ${batch.length} : ${fresh} nouvelles, ${batch.length - fresh} doublons refusés`);
    // No offer on a replayed batch: those points are minutes old, and an offer
    // that stale is already gone.
    json(res, 200, { ok: true });
  },

  /**
   * L'offre en attente pour ce chauffeur. Le pont de notifications ne transporte
   * que le titre et le texte — la table `data` d'un message FCM ne survit pas à
   * la notification posée par Android — donc l'application vient rechercher ici
   * ce que l'alerte n'a pas pu porter.
   */
  'GET /api/jobs/offer': (req, res) => {
    if (!authed(req)) return json(res, 401, { reason: 'expired_access' });
    if (!armed || activeJobId || Date.now() > armed.expiresAt) {
      log('offre en attente demandée : aucune à rendre');
      return json(res, 200, null);
    }
    const job = jobs.get(armed.jobId);
    log(`offre en attente demandée → course ${job.id} (alerte arrivée sans charge)`);
    json(res, 200, {
      ...job,
      // Une durée restante, pas une date : le téléphone n'a pas à faire confiance
      // à l'horloge du serveur.
      remainingSeconds: Math.max(0, Math.round((armed.expiresAt - Date.now()) / 1000)),
    });
  },

  'GET /api/jobs/active': (req, res) => {
    if (!authed(req)) return json(res, 401, { reason: 'expired_access' });
    json(res, 200, activeJobId ? jobs.get(activeJobId) : null);
  },

  'POST /api/shifts/start': (req, res) => {
    if (!authed(req)) return json(res, 401, { reason: 'expired_access' });
    shiftId = randomUUID();
    log(`service ouvert ${shiftId}`);
    json(res, 200, { shiftId });
  },

  'POST /api/shifts/end': async (req, res) => {
    const { abandonedJobId } = await body(req);
    if (abandonedJobId) log(`INCIDENT : hors ligne avec la course ${abandonedJobId} en charge`);
    log(`service fermé ${shiftId}`);
    shiftId = null;
    json(res, 200, { summary: { trips: trips.length, total: trips.reduce((sum, trip) => sum + trip.fare, 0) } });
  },

  'GET /api/earnings/today': (req, res) => {
    if (!authed(req)) return json(res, 401, { reason: 'expired_access' });
    const total = trips.reduce((sum, trip) => sum + trip.fare, 0);
    json(res, 200, { total, week: total, trips });
  },

  /**
   * Vue dispatch : la dernière position de chaque chauffeur, et sa trace sur
   * demande (`?trail=20`, plafonnée à TRAIL_MAX).
   *
   * Protégée par le token du chauffeur ici parce que le mock n'a qu'un rôle. Un
   * vrai serveur exige un rôle opérateur sur cette route : une position est une
   * donnée personnelle, et celle-ci les rend toutes d'un coup.
   */
  'GET /api/drivers/positions': (req, res) => {
    if (!authed(req)) return json(res, 401, { reason: 'expired_access' });
    const asked = Number(new URL(req.url ?? '/', 'http://mock').searchParams.get('trail') ?? 0);
    const trail = Math.min(Math.max(0, asked | 0), TRAIL_MAX);
    const now = Date.now();

    const drivers = [...tracks.entries()].map(([driverId, track]) => ({
      driverId,
      name: driverId === driver.id ? driver.name : driverId,
      // Un seul chauffeur dans ce mock, mais la réponse est une liste : une vue
      // dispatch n'a rien à changer le jour où il y en a vingt.
      //
      // Deux notions distinctes, et les confondre trompe le régulateur : le
      // service est ouvert (le chauffeur accepte des courses) n'est pas la même
      // chose que les positions arrivent encore (le téléphone parle).
      shiftOpen: shiftId !== null,
      jobId: activeJobId,
      step: activeJobId ? (jobs.get(activeJobId)?.step ?? null) : null,
      // Ce que regarde un régulateur en premier : la fraîcheur, pas la latitude.
      ageSeconds: track.last ? Math.round((now - track.last.receivedAt) / 1000) : null,
      reporting: track.last ? now - track.last.receivedAt < 3 * 60 * 1000 : false,
      last: track.last,
      ...(trail > 0 ? { trail: track.trail.slice(-trail) } : {}),
    }));

    json(res, 200, { drivers, count: drivers.length });
  },

  // --- test hooks, mock only -------------------------------------------------
  'POST /api/dev/offer': async (req, res) => {
    const { ttl = 30, delay = 0 } = await body(req);
    if (scheduled) {
      clearTimeout(scheduled);
      log('offre programmée précédente annulée');
    }
    // Scheduled server-side on purpose: a timer inside the application would die
    // with the application, and "app killed, phone locked" is exactly the case
    // this hook exists to test.
    if (delay > 0) {
      scheduled = setTimeout(() => {
        scheduled = null;
        armOffer(ttl);
      }, delay * 1000);
      log(`offre programmée dans ${delay} s (ttl ${ttl} s) — verrouille ou tue l'application maintenant`);
      return json(res, 200, { scheduledIn: delay, ttl });
    }
    const job = armOffer(ttl);
    json(res, 200, { jobId: job.id, ttl });
  },

  'POST /api/dev/expire-token': (_req, res) => {
    epoch += 1;
    log(`tokens d'accès invalidés (epoch ${epoch}) — le refresh reste valable`);
    json(res, 200, { epoch });
  },
};

function dynamic(method, path) {
  const accept = path.match(/^\/api\/jobs\/([^/]+)\/accept$/);
  if (accept && method === 'POST') {
    return (req, res) => {
      if (!authed(req)) return json(res, 401, { reason: 'expired_access' });
      const id = accept[1];
      const job = jobs.get(id);
      if (!job) return json(res, 404, { reason: 'unknown' });
      if (activeJobId) {
        log(`course ${id} refusee : deja attribuee`);
        return json(res, 409, { reason: 'taken' });
      }
      if (!armed || armed.jobId !== id || Date.now() > armed.expiresAt) {
        log(`course ${id} refusee : offre expiree`);
        return json(res, 409, { reason: 'expired' });
      }
      armed = null;
      activeJobId = id;
      job.step = null;
      log(`course ${id} attribuée`);
      return json(res, 200, { job });
    };
  }

  const decline = path.match(/^\/api\/jobs\/([^/]+)\/decline$/);
  if (decline && method === 'POST') {
    return (_req, res) => {
      if (armed?.jobId === decline[1]) armed = null;
      log(`course ${decline[1]} refusée`);
      return json(res, 204, null);
    };
  }

  const step = path.match(/^\/api\/jobs\/([^/]+)\/step$/);
  if (step && method === 'POST') {
    return async (req, res) => {
      if (!authed(req)) return json(res, 401, { reason: 'expired_access' });
      const job = jobs.get(step[1]);
      if (!job) return json(res, 404, { reason: 'unknown' });
      const { step: next } = await body(req);
      job.step = next;
      log(`course ${job.id} → ${next}`);
      if (next === 'completed') {
        trips.unshift({ id: job.id, endedAt: Date.now(), fare: job.fare, dropoff: job.dropoff.label });
        activeJobId = null;
      }
      return json(res, 200, { job });
    };
  }

  return null;
}

const log = (message) => console.log(`${new Date().toISOString().slice(11, 19)}  ${message}`);

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const key = `${req.method} ${path}`;
  const handler = routes[key] ?? dynamic(req.method ?? 'GET', path);
  if (!handler) return json(res, 404, { reason: 'no_route' });
  try {
    await handler(req, res);
  } catch (error) {
    log(`erreur ${key} : ${error.message}`);
    if (!res.headersSent) json(res, 500, { reason: 'server' });
  }
}).listen(PORT, '0.0.0.0', () => {
  log(`dispatch mock sur http://0.0.0.0:${PORT}`);
  log('émulateur : http://10.0.2.2:8788 — téléphone réel : remplace par l’IP de cette machine dans app.json');
  log('armer une offre :  curl -X POST http://localhost:8788/api/dev/offer -d \'{"ttl":30}\'');
  log('offre programmee : curl -X POST http://localhost:8788/api/dev/offer -d \'{"delay":30,"ttl":240}\'');
  log('expirer le token : curl -X POST http://localhost:8788/api/dev/expire-token');
  log('positions        : curl http://localhost:8788/api/drivers/positions?trail=5 -H "authorization: Bearer a.1.d1"');
});
