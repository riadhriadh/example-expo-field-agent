```bash
npx expo prebuild && npx expo run:android
```

**Toutes les fonctions de l'application ne marchent qu'après ce build.** Tant
qu'il n'a pas été lancé, il n'y a pas d'application : seulement un bundle
JavaScript qu'Expo Go peut afficher. Le suivi en arrière-plan, la bulle
flottante, la sonnerie, l'alerte plein écran, la file d'attente sur disque et
l'en-tête chiffré sont du code natif livré par
[`expo-field-agent`](https://www.npmjs.com/package/expo-field-agent) — il est
compilé par `prebuild` + `run:android`, jamais chargé à chaud.

| | avant le build (Expo Go) | après le build |
|---|---|---|
| connexion, navigation, écrans | ✅ | ✅ |
| envoi des positions | ❌ | ✅ |
| service de premier plan (survit au balayage, au kill, au redémarrage) | ❌ | ✅ |
| bulle flottante | ❌ | ✅ |
| alerte plein écran, sonnerie, écran qui s'allume | ❌ | ✅ |
| file d'attente hors réseau, jeton dans le keystore | ❌ | ✅ |
| push application tuée | ❌ | ✅ |

Les ❌ ne sont pas des réglages à activer : ils n'existent pas dans le binaire
Expo Go, et aucun contournement JavaScript n'est prévu pour les remplacer.

`yarn start` / `npm start` ne lance qu'un serveur de bundle. C'est l'application
installée par `npx expo run:android` qu'il faut ouvrir — **pas Expo Go**, qui
n'embarque aucun module natif et où `expo-notifications` lève d'ailleurs de
lui-même depuis le SDK 53 (*« Android Push notifications … was removed from Expo
Go »*).

### Ce qu'Expo Go donne quand même

L'application **démarre** dans Expo Go et laisse parcourir toute l'interface :
connexion, accueil, réglages, historique, diagnostic. C'est utile pour travailler
le rendu sans rebuild. Ce qu'elle n'y fera jamais, et qu'aucun contournement ne
rendra : envoyer une position, afficher la bulle, sonner, ouvrir l'alerte plein
écran. Le suivi ne sera pas simulé en JavaScript — ce serait exactement ce que le
cahier des charges interdit.

Une seule constante porte la distinction, [`src/native.ts`](src/native.ts) :

```ts
export const NATIVE = requireOptionalNativeModule('FieldAgent') !== null;
```

Le paquet laisse déjà passer les lectures (`getState`, `getPermissions`,
`addListener`, la bulle) ; ce sont les fonctions qui *agissent* qui lèvent —
`start`, `stop`, `setAuthHeader`, `openSettings`, `triggerAlert`,
`setAlertSound`, `setInterval`. Elles sont donc appelées seulement si `NATIVE`.

Côté interface, dans Expo Go :

| | |
|---|---|
| bandeau permanent | « Expo Go : interface seule, aucun suivi ni alerte. » |
| écran d'autorisations | plus de boucle : les neuf permissions sont `unsupported`, rien à accorder |
| Réglages | le son des offres et la bulle disparaissent — pas d'alerte à régler |
| Diagnostic | `running: false`, et `lastError` porte le message du paquet |
| serveur | le service s'ouvre mais `reporting: false` : personne n'envoie rien |

Le piège corrigé au passage : `login()` écrit le refresh token **avant**
d'appeler `setAuthHeader`. Une connexion « refusée » dans Expo Go avait donc déjà
persisté la session, et le message d'erreur accusait le mot de passe. Il ne le
fait plus que sur un vrai `HttpError`.

---

## Rider

Application chauffeur (équivalent Uber Driver côté conducteur). Elle ne
réimplémente rien de ce que le plugin fait déjà : le service de premier plan, la
file d'attente sur disque, l'envoi HTTP, l'en-tête d'authentification chiffré, la
bulle, l'alerte plein écran et l'échelle de permissions viennent tous du natif.
L'application décide **quand**, jamais **comment**.

Pas d'`expo-location`, pas d'`expo-task-manager` pour du suivi, pas de file en
AsyncStorage, aucun `setInterval` qui POSTe des positions depuis JavaScript.

### Démarrer

```bash
npm install
npm run server          # dispatch simulé sur :8788, node:http, zéro dépendance
npx expo prebuild && npx expo run:android
```

L'application vise `http://10.0.2.2:8788` (le `localhost` de l'émulateur). Sur un
**téléphone réel**, remplace cette adresse aux trois endroits de `app.json`
(`extra.apiUrl`, `tracking.url`, `tracking.batchUrl`) par l'IP LAN de ta machine.
Le HTTP en clair ne passe que parce qu'`expo prebuild` met
`usesCleartextTraffic="true"` dans le manifeste **debug** ; en production, HTTPS.

N'importe quel numéro et n'importe quel mot de passe ouvrent une session sur le
serveur simulé.

```bash
npm run check           # vérifie les dérivations d'état (7 assertions, sans runner)
npm run typecheck       # tsc --noEmit, strict
```

### APK autonome (pour tester app tuée, redémarrage, alerte au verrouillage)

Le build `debug` a besoin de Metro ; pour les scénarios où l'application ne doit
dépendre de rien, construis la variante `release` (bundle JS embarqué, signée
avec le keystore de debug par le template) :

```bash
cd android && ./gradlew :app:assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Une release ne reçoit **pas** le `usesCleartextTraffic="true"` que `prebuild`
met dans le manifeste de debug : pour viser le mock en HTTP, ajoute
`android:usesCleartextTraffic="true"` sur `<application>` dans
`android/app/src/main/AndroidManifest.xml` (un `prebuild` l'efface), ou sers le
mock en HTTPS.

### Provoquer une course

```bash
curl -X POST http://localhost:8788/api/dev/offer -H 'content-type: application/json' -d '{"ttl":30}'
```

Pour tester la notification quand tu n'es pas devant l'écran — téléphone
verrouillé, application balayée des récents — programme-la et va préparer le
téléphone pendant le délai :

```bash
curl -X POST http://localhost:8788/api/dev/offer -H 'content-type: application/json' -d '{"delay":30,"ttl":300}'
```

Le délai est tenu **par le serveur**, pas par un timer dans l'application : un
timer JS mourrait avec l'application, et « application tuée » est exactement le
cas qu'on veut tester. Une seconde programmation annule la précédente. Prends un
`ttl` large (300 s) : au repos, écran éteint, le battement de cœur espace les
positions à quelques minutes, et l'offre doit encore être valable quand la
prochaine part.

L'offre part **sur la réponse du prochain POST de position**. C'est le chemin
principal : aucun push, et ça fonctionne application tuée, parce que c'est le
service qui a fait la requête. Écran verrouillé, l'écran s'allume et sonne sur le
flux d'alarme.

---

## La machine à états

Un `useReducer` + contexte ([`src/store.tsx`](src/store.tsx)), une seule source de
vérité, et toutes les dérivations dans un module pur et testé
([`src/derive.ts`](src/derive.ts)).

```
OFFLINE ──en ligne──► IDLE ──offre──► OFFERED ──acceptée──► TO_PICKUP ──arrivé──► ARRIVED
   ▲                   ▲                  │                                          │
   └────hors ligne─────┴──refus/expiration┘                                    démarrer
                       ▲                                                              ▼
                       └──────────────────────terminer───────────────────────────  IN_TRIP
```

| État | `setInterval` | `setBubbleState` |
|---|---|---|
| `OFFLINE` | — (`stop()`) | `hideBubble()` |
| `IDLE` | cadence en attente (20 s par défaut) | `('ok', 'En ligne')` |
| `OFFERED` | idem | `('urgent', 'Nouvelle course')` |
| `TO_PICKUP` | 5 | `('warn', 'Vers le client')` |
| `ARRIVED` | 10 | `('warn', 'Sur place')` |
| `IN_TRIP` | 5 | `('ok', 'Course en cours')` |
| file non vide | inchangé | `('warn', 'Hors réseau')` |
| permission perdue | inchangé | `('bad', 'Localisation coupée')` |

`OFFLINE → IDLE` est impossible tant que `getPermissions()` ne rend pas
`location`, `backgroundLocation` et `notifications` à `granted` — et `autostart`
autre que `undetermined` sur les marques qui ont un écran de démarrage
automatique.

### La notification de service suit bien l'étape (depuis la 1.3.0)

Ce point a été livré en deux temps, et c'est honnête de le dire : jusqu'à la
1.2.0 le texte de la notification permanente était figé au build
(`notification.title` / `notification.body`) et aucune API ne le changeait à
chaud — la seule chose qui suivait l'étape était la bulle. `setStrings()`
(1.3.0) a levé la limite, et [`noticeFor()`](src/derive.ts) produit maintenant :

| État | Notification |
|---|---|
| `IDLE` / `OFFERED` | « En ligne — En attente de course. » |
| `TO_PICKUP` | « Course #1234 — En route vers le client. » |
| `ARRIVED` | « Course #1234 — Sur place, en attente du client. » |
| `IN_TRIP` | « Course #1234 — Course en cours. » |

`setStrings` est **persisté nativement** : après un redémarrage, le service
reprend le dernier texte connu sans qu'aucun JavaScript ne le lui redise. C'est
voulu, et c'est pourquoi l'effet de transition tourne aussi au boot — il corrige
le texte si la course s'est terminée entre-temps.

---

## Où chaque fonction du plugin est utilisée

| Fonction | Emplacement |
|---|---|
| `getPermissions()` | boot ([`src/store.tsx`](src/store.tsx)), retour au premier plan, focus de l'onboarding |
| `requestPermissions({ skip })` | bouton « Tout autoriser » ; `skip: ['dndAccess']` après un premier refus |
| `openSettings(nom)` | chaque ligne non accordée de l'onboarding, bannière « Localisation coupée » |
| `start({ intervalSeconds })` | « Passer en ligne » |
| `stop()` | « Passer hors ligne », après confirmation si une course est en charge |
| `isRunning()` | boot : reconstruit l'état après un kill ou un redémarrage |
| `setAuthHeader(v)` | après le login, après chaque refresh ([`src/api.ts`](src/api.ts)) |
| `setInterval(s)` | à chaque transition, selon le tableau |
| `flush()` | retour au premier plan, bouton « Réessayer », écran Diagnostic |
| `getState()` | bannière + Diagnostic, polling 5 s **seulement à l'écran** |
| `showBubble()` | juste après `start()` ; sa valeur de retour est le seul gate de l'UI de bulle |
| `hideBubble()` | dans `goOffline()` |
| `setBubbleState(s, t)` | à chaque transition, selon le tableau |
| `triggerAlert(...)` | listener push, tâche de fond app tuée, bouton de test du Diagnostic |
| `dismissAlert()` | acceptation, refus et expiration — via `actions.dismiss` d'`AlertHost` |
| `setAlertSound(b)` | réglage « Son des offres », restauré au boot |
| `getPendingAlert()` | retour au premier plan |
| `getPendingAlertSync()` | boot du store, pour reconstruire `OFFERED` sans attendre l'événement |
| `addListener('position')` | point du chauffeur sur la carte, vitesse, précision |
| `addListener('sent')` | bannière « Synchronisé », qui s'effface seule |
| `addListener('error')` | journal du Diagnostic, bannière, **et refresh de token sur `HTTP_401`** |
| `addListener('alert')` | passage en `OFFERED` quand l'application est déjà ouverte |
| `addListener('bubblePress')` | compteur d'usage uniquement, aucune navigation |
| `<AlertHost>` | monté une fois dans [`app/_layout.tsx`](app/_layout.tsx), au-dessus du routeur |

Les trois chemins d'arrivée d'une offre sont branchés : réponse serveur (natif,
rien à écrire), push app ouverte, push app tuée
([`src/push.ts`](src/push.ts)).

### Le 401 du service, qui ne peut pas se réparer tout seul

Le service POSTe sans JavaScript vivant : il utilise l'en-tête chiffré tel qu'il
est. Un access token périmé produit des `HTTP_401` — le plugin ne jette jamais ces
points, donc rien n'est perdu, mais la file monte jusqu'au plafond et **là** elle
commence à perdre. L'application écoute donc `error`, et sur `HTTP_401` /
`HTTP_403` elle renouvelle le token, rappelle `setAuthHeader` et vide la file
(au plus une tentative toutes les 30 s).

---

## Écrans

| Fichier | Écran |
|---|---|
| [`app/login.tsx`](app/login.tsx) | téléphone + mot de passe ; le refresh token va dans `expo-secure-store` |
| [`app/onboarding.tsx`](app/onboarding.tsx) | une ligne par permission, dans l'ordre rendu par le plugin, avec ce qui est perdu si elle manque |
| [`app/index.tsx`](app/index.tsx) | carte, point du chauffeur, interrupteur En ligne / Hors ligne, gains, bannière |
| [`src/offer.tsx`](src/offer.tsx) | offre plein écran, rendue par `AlertHost` |
| [`app/trip.tsx`](app/trip.tsx) | étape, client, « Naviguer » (Waze puis Google Maps), étape suivante |
| [`app/history.tsx`](app/history.tsx) | courses du jour, total jour et semaine |
| [`app/diagnostics.tsx`](app/diagnostics.tsx) | `getState()` en direct, les huit permissions, `flush()`, test d'alerte |
| [`app/settings.tsx`](app/settings.tsx) | son des offres, cadence en attente, bulle (si `showBubble()` a rendu `true`) |

Aucune coordonnée n'est journalisée : ni `console.log`, ni analytics. Le
Diagnostic n'affiche que des horodatages.

---

## Contrat serveur

Implémenté par [`server/index.mjs`](server/index.mjs) (mock, `node:http`, sans
dépendance).

```
POST /api/auth/login          → { access, refresh, driver }
POST /api/auth/refresh        → { access }
POST /api/positions           ← un point, envoyé par le plugin
POST /api/positions/batch     ← { positions: [...] }
GET  /api/jobs/active         → la course en cours, ou null
POST /api/jobs/:id/accept     → 200 { job } | 409 { reason: 'taken' | 'expired' }
POST /api/jobs/:id/decline    → 204
POST /api/jobs/:id/step       ← { step: 'arrived' | 'started' | 'completed' }
POST /api/shifts/start        → { shiftId }
POST /api/shifts/end          → { summary }
GET  /api/earnings/today      → { total, week, trips }
GET  /api/jobs/offer          → l'offre en attente (pour les alertes sans charge)
GET  /api/drivers/positions   → vue dispatch : dernière position par chauffeur
```

`GET /api/drivers/positions` (`?trail=20` pour joindre la trace, plafonnée à 50
points par chauffeur) :

```json
{ "count": 1, "drivers": [{
  "driverId": "d1", "name": "Riadh F.",
  "shiftOpen": true, "reporting": true, "ageSeconds": 9,
  "jobId": "1002", "step": "started",
  "last": { "clientId": "faa8469b…", "lat": 36.8, "lng": 10.18, "accuracy": 100,
            "speed": null, "heading": null, "altitude": 0,
            "recordedAt": 1789072221686, "heartbeat": false, "receivedAt": 1789072224410 }
}] }
```

`shiftOpen` (le chauffeur accepte des courses) et `reporting` (le téléphone parle
encore, moins de 3 min) sont deux choses différentes : les confondre fait croire
à un chauffeur disponible dont le téléphone est mort. `heartbeat: true` marque un
point envoyé sans mouvement, et `speed`/`heading` valent `null` quand la
plateforme ne les donne pas — c'est le cas sur émulateur.

L'identité vient du **token**, pas du corps de la requête : le point envoyé par le
plugin ne porte pas d'identifiant de chauffeur. Cette route est protégée par le
token du chauffeur dans le mock parce qu'il n'a qu'un rôle ; un vrai serveur y
exige un rôle opérateur, puisqu'elle rend d'un coup des données personnelles.

Le point arrive dans le format du plugin, en snake_case :
`{ client_id, lat, lng, accuracy, speed, heading, altitude, recorded_at, heartbeat }`.
**`client_id` est la clé d'unicité** : le mock la garde dans un `Set` et refuse
les doublons en le disant dans ses logs. Un vrai serveur y met un index unique.

La réponse d'un POST de position peut porter une offre :

```json
{ "ok": true, "alert": { "title": "Nouvelle course", "body": "3,2 km — 12 DT",
  "data": { "jobId": "1234", "pickup": {}, "dropoff": {}, "ttl": 30 } } }
```

Deux crochets de test, côté mock uniquement :

```bash
curl -X POST http://localhost:8788/api/dev/offer -d '{"ttl":30}'   # arme une offre
curl -X POST http://localhost:8788/api/dev/expire-token            # invalide les access tokens
```

---

## Critères d'acceptation — commandes

`PKG=tn.rider.app`

| # | Scénario | Commande | Attendu |
|---|---|---|---|
| 1 | app balayée des récents | `adb shell dumpsys activity services $PKG \| grep isForeground` | `isForeground=true`, les positions continuent |
| 2 | processus tué en course | `adb shell am crash $PKG` puis rouvrir | retour sur l'écran de course, pas l'accueil |
| 3 | redémarrage en service | `adb reboot`, attendre 2 min sans ouvrir l'app | le serveur reçoit à nouveau des positions |
| 4 | offre, écran verrouillé | `/api/dev/offer -d '{"delay":30,"ttl":300}'` puis verrouiller pendant le délai | écran qui se rallume seul, offre affichée, son sur le flux d'alarme, compte à rebours cohérent |
| 5 | offre en silencieux | `adb shell media volume --stream 4 --set 1` puis offre | ça sonne, volume restauré |
| 6 | offre expirée pendant l'ouverture | `/api/dev/offer -d '{"ttl":3}'` | l'offre ne s'affiche pas, `dismissAlert()`, retour à `IDLE` |
| 7 | deux appareils, même offre | accepter sur les deux | 200 d'un côté, 409 de l'autre avec message, sonnerie coupée des deux |
| 8 | tunnel de 10 min | `adb shell cmd connectivity airplane-mode enable` … `disable` | `queued` monte puis retombe à 0, aucun doublon (log du mock), pas de déconnexion |
| 9 | token expiré en service | `/api/dev/expire-token` | refresh automatique, `setAuthHeader` rappelé, la file se vide |
| 10 | bulle pendant Waze | ouvrir Waze | étape et couleur justes ; un tap ramène sur la course |
| 11 | iOS | `npx expo run:ios` | aucune UI de bulle, l'onboarding dit ce qui manque, suivi et offre fonctionnent |
| 12 | Diagnostic | ouvrir l'écran | `running`, `queued`, `lastFixAt`, `lastSentAt`, `lastError` et les 8 permissions à jour |

Le compte à rebours du critère 4 part de `alert.receivedAt`, pas du montage :
l'activité plein écran doit d'abord démarrer le moteur React Native, ce qui coûte
deux à quatre secondes sur un téléphone d'entrée de gamme. Si le TTL est déjà
écoulé, l'offre ne s'affiche pas du tout.

---

## Limites, dites une fois

- **iOS** : pas de bulle flottante (aucune API), pas de reprise après
  redémarrage ni après une fermeture forcée. `showBubble()` rend `false`, et
  toute l'UI de bulle est masquée — la condition est cette valeur de retour, pas
  `Platform.OS`, parce que sur Android sans la permission overlay elle rend
  `false` aussi. Sonner en silencieux demande l'entitlement Critical Alerts
  d'Apple.
- **`fullScreenIntent` refusé** (Android 14) : l'offre dégrade en notification
  ordinaire, et l'onboarding le dit avec une phrase.
- **`autostart`** : aucune API ne peut le lire ni l'accorder. Le plugin marque
  `granted` une fois que l'utilisateur y est passé, et passer en ligne est bloqué
  tant que l'état est `undetermined`.
- **Batterie** : `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` n'est jamais demandée
  (Google Play retire les applications qui l'utilisent sans y avoir droit).
  `openSettings('batteryUnrestricted')` ouvre la liste système.
- **Carte** : `react-native-maps` utilise Google Maps sur Android, et Google
  Maps **tue le process** quand la clé API manque — il ne dégrade pas en tuiles
  grises. L'accueil ne monte donc la carte que si
  `android.config.googleMaps.apiKey` est présent dans `app.json` (ou sur iOS, où
  Apple Maps n'a besoin d'aucune clé) ; sinon il affiche la dernière position
  reçue du service en clair. Ajoute ta clé pour avoir la carte.
- **`stop()` en course** : demande confirmation et prévient le serveur
  (`POST /api/shifts/end` avec l'id de la course abandonnée), parce qu'un
  chauffeur hors ligne avec un client dans la voiture est un incident.

## Le volume de l'alerte

`alert.forceVolume: true` et `alert.volumeLevel: 1` (1.2.0) : pendant une offre,
le flux d'alarme est poussé au maximum de l'appareil. C'est un **plancher, jamais
un plafond** — un chauffeur qui garde déjà son alarme plus fort garde son niveau,
et rien n'est enregistré dans ce cas. L'ancien volume est sauvé sur disque par le
plugin, donc un process tué en pleine alerte ne laisse pas le réveil bloqué au
max : il est restauré au démarrage suivant.

Le seul flux qu'Android joue encore en silencieux, c'est celui-là. `forceVolume:
false` rendrait la main au niveau choisi par l'utilisateur — mauvais choix pour un
chauffeur dont le téléphone est dans une poche.

## La bulle : une couleur, un mot, un glyphe

`bubble.icon` embarque [`assets/bubble-wheel.png`](assets/bubble-wheel.png) au
build, et `setBubbleImage()` (1.3.0) le remplace à chaud selon l'étape — parce
que par-dessus Waze, au milieu d'un carrefour, une forme se lit plus vite qu'un
mot :

| État | Glyphe | Couleur | Texte |
|---|---|---|---|
| `IDLE` / `OFFERED` | volant | vert / violet | En ligne · Nouvelle course |
| `TO_PICKUP` | flèche | ambre | Vers le client |
| `ARRIVED` | épingle | ambre | Sur place |
| `IN_TRIP` | client | vert | Course en cours |

Les quatre PNG sont générés, blancs sur transparent, 96 px (24 dp en xxxhdpi) —
la pastille sous l'image porte déjà la couleur de l'état. Pour les régler :

```bash
python3 assets/make-bubble-icons.py
```

`setBubbleImage` n'accepte que des sources **locales** (`file://`, chemin absolu,
`content://`, ou un `require()`) : le téléchargement appartient à l'hôte, qui a
son authentification et son cache, et la bulle doit rester une fenêtre légère.
Une source `http(s)` est refusée par un événement `error` de code
`BUBBLE_IMAGE`, pas ignorée en silence.

## La sonnerie

`assets/alerte.wav` est embarqué via `alert.sound` et copié par le plugin dans
`res/raw/field_agent_alert.wav` avec `noCompress`. C'est **le seul son qui ne
dépend pas de la ROM** : sans lui, le natif retombe sur les sonneries système, et
sur un émulateur ou un Xiaomi elles reviennent régulièrement illisibles —
`SOUND: Aucune sonnerie lisible` en boucle dans le Diagnostic, et une offre
muette.

Le clip fait 1,6 s, commence et finit sur du silence (le natif le joue en boucle,
une couture s'entendrait à chaque tour) et culmine à ~48 % de l'échelle, parce que
le plugin pousse déjà le volume d'alarme au maximum. Pour le régler :

```bash
python3 assets/make-alert-sound.py
```

Changer le son sur un appareil déjà installé demande aussi de monter
`alert.channelVersion` : Android garde à vie les attributs d'un canal déjà créé.

## Le pont de notifications

`alert.notificationBridge: true` (1.2.0) déclare un `NotificationListenerService`.
C'est **le seul moyen** d'attraper un message FCM qui porte un bloc
`notification` alors que l'application n'est pas au premier plan : dans ce cas le
SDK Firebase pose la notification lui-même et n'appelle jamais le code de
l'application — ni `onMessageReceived`, ni tâche de fond, ni `triggerAlert()`.

**Ce que ça coûte, et c'est à décider avant de publier :**
`BIND_NOTIFICATION_LISTENER_SERVICE` entre au manifeste, et **Google Play examine
toute application qui le déclare** en attendant que l'accès aux notifications
soit une fonctionnalité centrale. Le plugin le rappelle à chaque `prebuild`. Le
correctif gratuit est chez l'émetteur — un message **data-only**, aucune clé
`notification` nulle part — et c'est déjà le cas ici comme via le service push
d'Expo. Le pont sert quand le push vient d'un système qu'on ne contrôle pas.
Pour le couper : `"notificationBridge": false` dans `app.json`, puis `prebuild`.

**La charge `data` ne survit pas à ce chemin.** Une notification posée porte son
titre, son texte, son tag et son canal — pas la table `data`. L'alerte arrive
avec `data.source === 'notificationBridge'` et rien d'autre. L'écran d'offre le
détecte et va chercher le reste par l'API (`GET /api/jobs/offer`), compte à
rebours compris : le serveur rend une **durée restante**, pas une date, pour que
le téléphone n'ait pas à faire confiance à l'horloge du serveur. Sans identifiant
de course résolu, « Accepter » reste désactivé — accepter dans le vide enverrait
le chauffeur nulle part.

La permission correspondante, `notificationAccess`, apparaît dans l'onboarding et
le Diagnostic avec les huit autres. Elle n'est **jamais bloquante** pour passer en
ligne (une assertion de `npm run check` le verrouille) : le chemin principal, la
réponse serveur sur une position, n'en a aucun besoin.

## Dépendances

`expo-field-agent`, `expo-router`, `expo-notifications`, `expo-task-manager`
(uniquement la réception push app tuée), `expo-secure-store`, `react-native-maps`,
`expo-linking`, `expo-constants`, plus `react-native-screens` et
`react-native-safe-area-context` qu'`expo-router` exige. Aucune bibliothèque
d'état, de formulaire ou d'UI.

`overrides.react-dom` est épinglé sur la version de `react` du SDK : sans ça,
`npm install` échoue sur un conflit de peer dependency hérité du template.
