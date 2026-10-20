// Id for a pole placed on an existing span a–b (Stage 7.11).
//
// A span has no stored orientation: its frame is the order of its two pole ids
// (min id → max id). That frame decides the order of parallel cables on the span
// (cableLayout.ts) and the side and rotation of its distance label
// (SketchCanvas renderConnectionLabels). A new pole with a random id can sit on
// either side of a or b in that order, so one of the two new spans could get the
// opposite frame: the parallel cables were mirrored on it (crossing at the new
// pole and looking squeezed on a short span) and its label jumped to the other
// side, upside down.
//
// Giving the new pole an id that sorts strictly between the two ids keeps both new
// spans in the frame of the original span: same cables, same directions, same
// offsets, so the same order and spacing, and the label on the same side. Nothing
// else changes: layouts that do not involve the new pole are untouched.
//
// Comparison is plain string order (`<`, as used by the layout and `.sort()`).
// idBetween / splitPoleId return null when no suitable id can be made. Ids made by
// the app (base-36 letters and digits, and the ids made here) always have one; null
// only happens for unusual ids from an imported file (a character below '-' right
// after the shared start, or an id that is the other one plus '-' only) or if every
// try collides. A random id would bring the mirrored cables back, so the canvas does
// not fall back to one: midPoleId turns the failure into a refusal with a message,
// and nothing is changed.

const randomPart = (rand: () => number) => rand().toString(36).slice(2, 11) || 'x';

export const idBetween = (
  lo: string,
  hi: string,
  exists: (id: string) => boolean,
  rand: () => number = Math.random,
): string | null => {
  if (!(lo < hi)) return null;
  // Every candidate is `prefix + '-' + random`, with `prefix` starting with lo, so it
  // sorts after lo. It sorts before hi unless hi starts with prefix + '-' (an id made
  // here before): then the prefix grows past that '-' and the check repeats.
  let prefix = lo;
  while (hi.startsWith(prefix)) {
    const rest = hi.slice(prefix.length);
    if (rest === '') return null;
    if (rest[0] > '-') break; // prefix + '-' + … < prefix + rest
    if (rest[0] === '-') { prefix += '-'; continue; }
    return null; // hi continues with a character below '-': no safe id between
  }
  for (let i = 0; i < 20; i++) {
    const id = `${prefix}-${randomPart(rand)}`;
    if (lo < id && id < hi && !exists(id)) return id;
  }
  return null;
};

/** Id for a pole placed on the span between poles a and b (either order). */
export const splitPoleId = (a: string, b: string, exists: (id: string) => boolean, rand: () => number = Math.random): string | null =>
  a < b ? idBetween(a, b, exists, rand) : idBetween(b, a, exists, rand);

export const MID_POLE_REFUSED =
  'تعذّرت إضافة عمود على هذا المقطع: معرّفات عمودَي المقطع غير مألوفة (غالبًا من ملف مستورد)، ' +
  'فلا يمكن ضمان بقاء ترتيب الكوابل المتوازية وجهة رقم المسافة كما هي. لم يتغيّر شيء في الرسم.';

export type MidPoleId = { ok: true; id: string } | { ok: false; message: string };

/** The id to use for a pole placed on span a–b, or a refusal (never a random id that could mirror the cables). */
export const midPoleId = (a: string, b: string, exists: (id: string) => boolean, rand: () => number = Math.random): MidPoleId => {
  const id = splitPoleId(a, b, exists, rand);
  return id ? { ok: true, id } : { ok: false, message: MID_POLE_REFUSED };
};
