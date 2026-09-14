import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Expo Go est un binaire figé : aucun module natif du projet n'y est compilé.
 *
 * Le paquet laisse déjà passer les lectures — `getState`, `getPermissions`,
 * `addListener`, la bulle — mais lève sur tout ce qui *agit* : démarrer le
 * service, écrire le jeton dans le keystore, ouvrir un réglage système. On teste
 * donc la présence du module plutôt que d'attraper l'erreur après coup, ce qui
 * évite de deviner à partir d'un message.
 *
 * Même mécanisme que le paquet lui-même, pas une heuristique — et pas une
 * dépendance de plus : `expo-modules-core` arrive avec `expo`.
 */
export const NATIVE = requireOptionalNativeModule('FieldAgent') !== null;
