import { AppError } from './errors.js';

export const standardTransformations = {
    none: (value) => value,
    caps: (value) => value.toUpperCase(),
    lows: (value) => value.toLowerCase(),
    voivodeshipAsMasculineNominative: (voivodeship) => voivodeship.replace(/E$/, ''),
    voivodeshipAsGenitiveAdjective: (voivodeship) => voivodeship + 'GO'
};

/**
 * Returns `transform(value, name?)`. Transformations are looked up first in the PDF-specific
 * script module (`<pdf-name>.js`, if any), then in the standard set. When `name` is omitted the
 * metadata's `global.defaultTransform` applies, falling back to 'none'.
 */
export function createTransformer({ defaultTransform, script } = {}) {
    return (value, name) => {
        const transformName = name ?? defaultTransform ?? 'none';
        const transformer = script?.[transformName]
            ?? (Object.hasOwn(standardTransformations, transformName) ? standardTransformations[transformName] : undefined);
        if (typeof transformer !== 'function') {
            throw new AppError(`Unknown transformation '${transformName}'`);
        }
        return transformer(value);
    };
}
