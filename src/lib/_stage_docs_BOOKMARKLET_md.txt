# Token-grabber bookmarklet

A small JavaScript snippet that finds the STFC store JWT in your browser's
storage, validates it against the live API, and copies the working one to
your clipboard. Use it once per browser profile to capture the token you
paste into the `STFC_ACCOUNTS` GitHub secret (see [SETUP.md](SETUP.md)).

## What it does

- Iterates every key in `localStorage` **and** `sessionStorage`.
- For each value, checks whether it looks like a JWT (three base64url
  segments separated by `.`).
- For values that are JSON, recursively scans the parsed object for any
  JWT-shaped substrings as well — STFC stores its tokens nested inside
  larger JSON blobs.
- Decodes each candidate's payload and reads `iss`, `aud`, and `exp`.
- Validates each candidate by calling
  `GET https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me`
  with `Authorization: Bearer <candidate>`.
- Copies the **first** candidate that returns HTTP 200 to your clipboard
  via `navigator.clipboard.writeText`.
- Logs every candidate's status (`valid`, `invalid`, `expired`) to the
  console along with its `iss` and `exp`, so you can debug if nothing
  works.
- Shows an `alert()` with the final result.

## How to use as a console snippet

1. Log in to `https://home.startrekfleetcommand.com/store`.
2. Open DevTools (`F12`) → **Console** tab.
3. Paste the snippet below and press Enter.
4. Approve the clipboard permission prompt if your browser asks for one.
5. You should see `Copied valid token to clipboard. Expires <date>`.

```js
(async () => {
  const API = "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me";
  const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

  const b64urlDecode = (s) => {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    try { return atob(s); } catch { return null; }
  };
  const decode = (jwt) => {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const raw = b64urlDecode(parts[1]);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };

  const candidates = new Set();
  const harvest = (val) => {
    if (typeof val !== "string") return;
    const matches = val.match(JWT_RE);
    if (matches) for (const m of matches) candidates.add(m);
    if (val.startsWith("{") || val.startsWith("[")) {
      try {
        const parsed = JSON.parse(val);
        const walk = (n) => {
          if (typeof n === "string") harvest(n);
          else if (Array.isArray(n)) n.forEach(walk);
          else if (n && typeof n === "object") Object.values(n).forEach(walk);
        };
        walk(parsed);
      } catch { /* not JSON, ignore */ }
    }
  };

  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      harvest(store.getItem(k));
    }
  }

  console.log(`[stfc-token] found ${candidates.size} JWT-shaped candidate(s)`);

  let winner = null;
  let winnerExp = null;
  for (const jwt of candidates) {
    const payload = decode(jwt);
    const iss = payload?.iss ?? "?";
    const exp = payload?.exp ? new Date(payload.exp * 1000) : null;
    if (exp && exp.getTime() < Date.now()) {
      console.log(`[stfc-token] expired  iss=${iss} exp=${exp.toISOString()}`);
      continue;
    }
    try {
      const res = await fetch(API, { headers: { Authorization: "Bearer " + jwt } });
      if (res.ok) {
        console.log(`[stfc-token] valid    iss=${iss} exp=${exp?.toISOString() ?? "?"}`);
        if (!winner) { winner = jwt; winnerExp = exp; }
      } else {
        console.log(`[stfc-token] invalid  iss=${iss} status=${res.status}`);
      }
    } catch (e) {
      console.log(`[stfc-token] error    iss=${iss}`, e);
    }
  }

  if (winner) {
    await navigator.clipboard.writeText(winner);
    alert(`Copied valid token to clipboard. Expires ${winnerExp ? winnerExp.toLocaleString() : "unknown"}`);
  } else {
    alert("No valid token found in storage. Are you logged in?");
  }
})();
```

## How to install as a bookmarklet

If you'd rather click a bookmark than open DevTools every time:

1. Create a new bookmark in your browser (right-click bookmarks bar →
   *Add page…* in most browsers).
2. Set the **name** to something like `STFC token grabber`.
3. Set the **URL** to the single-line `javascript:` snippet below.
4. Navigate to the STFC store page and click the bookmark.

```text
javascript:(async()=>{const A="https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me",R=/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,d=s=>{s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";try{return atob(s)}catch{return null}},D=j=>{const p=j.split(".");if(p.length!==3)return null;const r=d(p[1]);if(!r)return null;try{return JSON.parse(r)}catch{return null}},c=new Set,h=v=>{if(typeof v!=="string")return;const m=v.match(R);if(m)for(const x of m)c.add(x);if(v.startsWith("{")||v.startsWith("[")){try{const p=JSON.parse(v),w=n=>{if(typeof n==="string")h(n);else if(Array.isArray(n))n.forEach(w);else if(n&&typeof n==="object")Object.values(n).forEach(w)};w(p)}catch{}}};for(const s of[localStorage,sessionStorage])for(let i=0;i<s.length;i++)h(s.getItem(s.key(i)));console.log("[stfc-token] found "+c.size+" candidate(s)");let W=null,E=null;for(const j of c){const p=D(j),I=p?.iss??"?",e=p?.exp?new Date(p.exp*1e3):null;if(e&&e.getTime()<Date.now()){console.log("[stfc-token] expired iss="+I);continue}try{const r=await fetch(A,{headers:{Authorization:"Bearer "+j}});if(r.ok){console.log("[stfc-token] valid iss="+I);if(!W){W=j;E=e}}else console.log("[stfc-token] invalid iss="+I+" "+r.status)}catch(x){console.log("[stfc-token] error iss="+I,x)}}if(W){await navigator.clipboard.writeText(W);alert("Copied valid token to clipboard. Expires "+(E?E.toLocaleString():"unknown"))}else alert("No valid token found in storage. Are you logged in?")})();
```

## Privacy

This snippet runs **entirely in your browser**. The only network request it
makes is to the official STFC store API (`/auth/me`) — the same endpoint
your browser calls on every page load. The token is written to your local
clipboard via `navigator.clipboard.writeText`. Nothing is sent to a third
party, nothing is logged remotely, nothing is uploaded anywhere. The
source above is the entire code — read it and verify before running it.
