/** Comparison modes available to the `dependsOn` / `comparison` / `argument` metadata attributes. */
export const comparators = {
    equals: (sourceValue, argument) => String(sourceValue) === String(argument)
};
