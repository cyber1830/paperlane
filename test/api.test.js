import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';

test('create, sanitize, share, and enforce access', async () => {
  const srv = createApp(':memory:').listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  const call = (u, p, method = 'GET', body) => fetch(base + p, {method, headers:{'x-user-id':String(u),'content-type':'application/json'}, body: body && JSON.stringify(body)});
  try {
    const doc = await (await call(1, '/docs', 'POST', {title:'Plan'})).json();
    await call(1, `/docs/${doc.id}`, 'PUT', {content:'<p>Hi <b>there</b></p><script>alert(1)</script>'});
    assert.equal((await (await call(1, `/docs/${doc.id}`)).json()).content, '<p>Hi <b>there</b></p>');
    assert.equal((await call(2, `/docs/${doc.id}`)).status, 404);
    assert.equal((await call(1, `/docs/${doc.id}/share`, 'POST', {email:'bob@paperlane.test'})).status, 200);
    assert.equal((await call(2, `/docs/${doc.id}`)).status, 200);
    assert.equal((await call(2, `/docs/${doc.id}/share`, 'POST', {email:'carol@paperlane.test'})).status, 403);
    assert.equal((await (await call(2, '/docs')).json())[0].role, 'shared');
    assert.equal((await call(1, `/docs/${doc.id}`, 'PUT', {title:' '})).status, 400);
  } finally { srv.close(); }
});

test('viewer role is read-only; owner can upgrade and revoke', async () => {
  const srv = createApp(':memory:').listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  const call = (u, p, method = 'GET', body) => fetch(base + p, {method, headers:{'x-user-id':String(u),'content-type':'application/json'}, body: body && JSON.stringify(body)});
  try {
    const doc = await (await call(1, '/docs', 'POST', {title:'Spec'})).json();
    assert.equal((await call(1, `/docs/${doc.id}/share`, 'POST', {email:'bob@paperlane.test', role:'admin'})).status, 400);
    await call(1, `/docs/${doc.id}/share`, 'POST', {email:'bob@paperlane.test', role:'viewer'});
    assert.equal((await (await call(2, `/docs/${doc.id}`)).json()).role, 'viewer');
    assert.equal((await call(2, `/docs/${doc.id}`, 'PUT', {content:'<p>x</p>'})).status, 403);
    await call(1, `/docs/${doc.id}/share`, 'POST', {email:'bob@paperlane.test', role:'editor'});
    assert.equal((await call(2, `/docs/${doc.id}`, 'PUT', {content:'<p>x</p>'})).status, 200);
    assert.equal((await call(2, `/docs/${doc.id}/share/3`, 'DELETE')).status, 403);
    assert.equal((await call(1, `/docs/${doc.id}/share/2`, 'DELETE')).status, 200);
    assert.equal((await call(2, `/docs/${doc.id}`)).status, 404);
  } finally { srv.close(); }
});

test('version history snapshots, restores, blocks viewers; presence lists others', async () => {
  const srv = createApp(':memory:').listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  const call = (u, p, method = 'GET', body) => fetch(base + p, {method, headers:{'x-user-id':String(u),'content-type':'application/json'}, body: body && JSON.stringify(body)});
  try {
    const doc = await (await call(1, '/docs', 'POST', {title:'Notes'})).json();
    await call(1, `/docs/${doc.id}`, 'PUT', {content:'<p>A</p>'});
    await call(1, `/docs/${doc.id}`, 'PUT', {content:'<p>B</p>'});
    const versions = await (await call(1, `/docs/${doc.id}/versions`)).json();
    assert.equal(versions.length, 1);
    assert.equal((await (await call(1, `/docs/${doc.id}/versions/${versions[0].id}`)).json()).content, '<p>A</p>');

    await call(1, `/docs/${doc.id}/share`, 'POST', {email:'bob@paperlane.test', role:'viewer'});
    assert.equal((await call(2, `/docs/${doc.id}/versions/${versions[0].id}/restore`, 'POST')).status, 403);
    assert.equal((await call(1, `/docs/${doc.id}/versions/${versions[0].id}/restore`, 'POST')).status, 200);
    assert.equal((await (await call(1, `/docs/${doc.id}`)).json()).content, '<p>A</p>');
    assert.equal((await (await call(1, `/docs/${doc.id}/versions`)).json()).length, 2);

    await call(1, `/docs/${doc.id}/presence`, 'POST');
    const seen = await (await call(2, `/docs/${doc.id}/presence`, 'POST')).json();
    assert.equal(seen[0].name, 'Alice');
  } finally { srv.close(); }
});