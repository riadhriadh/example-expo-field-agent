import * as FieldAgent from 'expo-field-agent';

/**
 * Les deux chemins push vers l'écran plein. Le chemin principal n'est pas ici :
 * le serveur rend l'offre dans la réponse à un POST de position, que le service
 * de premier plan consomme sans le moindre JavaScript vivant. Un push peut être
 * retardé de plusieurs minutes par le réseau ; la réponse à une requête que le
 * service vient de faire, non.
 *
 * `triggerAlert` rend la main sans rien faire quand rien ne correspond à
 * `alert.titlePattern`, donc les deux chemins sont branchés sur toutes les
 * notifications plutôt que triés ici.
 *
 * `require` plutôt qu'un import statique, et c'est le cœur du sujet : dans Expo
 * Go, importer expo-notifications **lève à l'évaluation du module** (le push
 * Android en a été retiré au SDK 53). Un import statique emportait alors tout le
 * bundle — `_layout` n'exportait plus rien et le routeur tombait sur une erreur
 * illisible. Ici l'échec reste local et l'application démarre, ce qui lui laisse
 * la possibilité de dire ce qui manque.
 */
declare const require: (name: string) => any;

const TASK = 'rider-push';

try {
  const Notifications = require('expo-notifications');
  const TaskManager = require('expo-task-manager');

  /** Enregistrée à l'évaluation du bundle : sur Android ce code tourne en headless JS, application tuée. */
  TaskManager.defineTask(TASK, async ({ data, error }: { data: any; error: unknown }) => {
    if (error || !data) return;
    const push = data.notification?.data ?? data;
    await FieldAgent.triggerAlert({
      title: push.title ?? '',
      body: push.body,
      data: push,
      tag: push.tag,
      channelId: push.channelId,
    });
  });

  // Messages FCM data-only, sinon Android dessine sa propre notification par-dessus.
  void Notifications.registerTaskAsync(TASK).catch(() => {});

  Notifications.addNotificationReceivedListener(({ request }: { request: any }) => {
    const { title, body, data } = request.content;
    void FieldAgent.triggerAlert({
      title: title ?? '',
      body: body ?? undefined,
      data: data as Record<string, unknown>,
      tag: data?.tag,
      channelId: request.trigger?.channelId,
    });
  });
} catch (error) {
  // Pas de push ici — et on le dit, plutôt que d'avaler l'erreur : dans un
  // development build ce message signalerait une vraie panne.
  console.warn('[rider] push indisponible :', error instanceof Error ? error.message : error);
}
