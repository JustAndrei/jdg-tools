/*
 * Profiles of one form in localStorage. Keys are laid out like a folder tree:
 *   <form>/profiles/<profile name>   the serialized form (JSON)
 *   <form>/currentProfile            the name of the profile that is on the screen
 * localStorage can be unavailable (privacy mode, blocked cookies): then nothing is remembered,
 * but the page keeps working.
 */

const profileKey = (form, name) => `${form}/profiles/${name}`;
const currentKey = (form) => `${form}/currentProfile`;

function safely(action, fallback) {
    try {
        return action();
    } catch (error) {
        console.warn('localStorage is not available', error);
        return fallback;
    }
}

/** Names of the saved profiles, in alphabetical order. */
export function listProfiles(form) {
    const prefix = profileKey(form, '');
    return safely(() => {
        const names = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(prefix)) names.push(key.slice(prefix.length));
        }
        return names.sort((a, b) => a.localeCompare(b));
    }, []);
}

export function hasProfile(form, name) {
    return safely(() => localStorage.getItem(profileKey(form, name)) !== null, false);
}

/** The saved state of a profile, or null if there is none (or it is damaged). */
export function loadProfile(form, name) {
    return safely(() => {
        const json = localStorage.getItem(profileKey(form, name));
        return json === null ? null : JSON.parse(json);
    }, null);
}

/** @returns {boolean} whether the profile was saved */
export function saveProfile(form, name, state) {
    return safely(() => {
        localStorage.setItem(profileKey(form, name), JSON.stringify(state));
        return true;
    }, false);
}

export function getCurrentProfile(form) {
    return safely(() => localStorage.getItem(currentKey(form)), null);
}

export function setCurrentProfile(form, name) {
    safely(() => localStorage.setItem(currentKey(form), name));
}

/** Removes all the profiles of the form and the current-profile mark. */
export function clearProfiles(form) {
    const prefix = profileKey(form, '');
    safely(() => {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(prefix)) keys.push(key);
        }
        keys.forEach((key) => localStorage.removeItem(key));
        localStorage.removeItem(currentKey(form));
    });
}
