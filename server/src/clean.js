// Strip control/bidi characters and cap the length (hostile-input hygiene, shared shape).
export const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max);
