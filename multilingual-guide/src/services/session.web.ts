// Browser demo: keep token only in memory, never persist JWT in localStorage.
let value:string|null=null;
export async function getSessionToken(){return value;}
export async function writeSessionToken(token:string|null){value=token;}
