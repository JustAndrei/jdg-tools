/* global $ */

/** Copy of `obj` without properties whose value is `undefined`, so spreading it never overrides defaults. */
export function definedOnly(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

/** Form control(s) with the given `name` attribute. */
export function byName(name) {
    return $(`[name="${CSS.escape(name)}"]`);
}
