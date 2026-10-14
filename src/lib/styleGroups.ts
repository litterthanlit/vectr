/**
 * The inspector's style sections and the style params each one shows (in schema order). A style param that is in no
 * group has no control at all, so styleGroups.test.ts checks that every one of them is in exactly one.
 */
export const STYLE_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Line', keys: ['width', 'dash', 'taper', 'taperAmount', 'hidden'] },
  { title: 'Colour', keys: ['color', 'colorBy'] },
  {
    title: 'Fill, markers & finish',
    keys: ['fill', 'fillOpacity', 'knockout', 'markers', 'markerSize', 'markerEvery', 'markersByDepth', 'finish', 'finishAmount', 'finishScale', 'finishSeed'],
  },
  { title: 'Labels & opacity', keys: ['labels', 'labelSize', 'labelFont', 'opacity'] },
];
