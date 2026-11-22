import test from "node:test";
import assert from "node:assert/strict";
import { cleanName, fetchDisplayName, refreshDisplayName, MAX_NAME_LENGTH } from "./names.js";

const reply = (status, body) => async () => ({ status, json: async () => body });

test("cleanName trims, strips control characters and caps the length", () => {
  assert.equal(cleanName("  Dan \u0000Ward\n "), "Dan Ward");
  assert.equal(cleanName("x".repeat(500)).length, MAX_NAME_LENGTH);
  for (const bad of ["", "   ", null, undefined, 5, {}]) assert.equal(cleanName(bad), null);
});

test("fetchDisplayName returns the name, or null on any failure", async () => {
  assert.equal(await fetchDisplayName("U1", reply(200, { displayName: " Dan " })), "Dan");
  assert.equal(await fetchDisplayName("U1", reply(404, { displayName: "Dan" })), null);
  assert.equal(await fetchDisplayName("U1", reply(200, { displayName: 7 })), null);
  assert.equal(await fetchDisplayName("U1", async () => { throw new Error("offline"); }), null);
});

test("fetchDisplayName only sends the encoded slack id", async () => {
  let seen;
  await fetchDisplayName("U/1 2", async (url) => { seen = url; return { status: 404 }; });
  assert.equal(seen, "https://cachet.dunkirk.sh/users/U%2F1%202");
});

test("refreshDisplayName writes the name only when one was found", async () => {
  const writes = [];
  const env = { DB: { prepare: (sql) => ({ bind: (...args) => ({ run: async () => writes.push({ sql, args }) }) }) } };
  await refreshDisplayName(env, 7, "U1", reply(200, { displayName: "Dan" }));
  await refreshDisplayName(env, 8, "U2", reply(404, {}));
  assert.deepEqual(writes, [{ sql: "UPDATE users SET display_name = ? WHERE id = ?", args: ["Dan", 7] }]);
});
