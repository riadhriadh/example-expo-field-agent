/** Metro rend un identifiant d'asset (un nombre) pour une image importée — c'est ce que `setBubbleImage` attend. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
