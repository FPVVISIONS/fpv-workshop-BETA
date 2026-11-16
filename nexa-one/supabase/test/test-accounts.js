// End-to-end test of the Supabase accounts through the real UI, against mock-supabase.mjs.
//   node test/mock-supabase.mjs 8790 &            (mock Supabase)
//   python3 -m http.server 8769 -d <extracted assets/public with nexa-config.js pointing at the mock> &
//   STAGE=http://localhost:8769 MOCK=http://localhost:8790 node test/test-accounts.js
const { chromium, devices } = require('playwright');
const STAGE = process.env.STAGE || 'http://localhost:8769', MOCK = process.env.MOCK || 'http://localhost:8790';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(MOCK + p)).json();
const post = async (p, b) => (await fetch(MOCK + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const scr = '#fx-auth .fa-screen:last-child';
  const inputs = () => p.locator(`${scr} input.fa-input`);
  const submit = () => p.locator(`${scr} button[type=submit]`).click();
  const userNow = () => p.evaluate(() => window.NexaAuth.user && window.NexaAuth.user.email);
  const nameNow = () => p.evaluate(() => window.NexaAuth.user && window.NexaAuth.user.name);
  const banner = async () => (await p.locator('#fx-auth .fa-banner, #fx-account .fa-banner').allTextContents()).join(' | ');
  const fresh = async () => { await p.goto(STAGE + '/index.html'); await p.waitForTimeout(2300); };
  const openAccount = async () => { await p.locator('header button[aria-label="פרופיל והעדפות"]').click(); await p.waitForTimeout(800); };
  const guideOff = () => p.addInitScript(() => { localStorage.setItem('nexa-guide:connect:v1', '1'); });
  await guideOff();

  await post('/__config', { confirm: true, ttl: 3600 });
  console.log('1. sign up with e-mail confirmation ON');
  await fresh();
  ok(await p.evaluate(() => window.NexaAuth.user === null), 'starts signed out');
  ok(!(await p.locator('#fx-auth .fa-note').allTextContents()).join('').includes('מצב הדגמה'), 'the "demo mode · on this device" note is hidden with a real backend');
  await p.getByRole('button', { name: 'יצירת חשבון' }).click(); await p.waitForTimeout(900);
  await inputs().nth(0).fill('דנה כהן'); await inputs().nth(1).fill('dana@example.com'); await inputs().nth(2).fill('Cold-Water-2026');
  await p.locator('#fx-auth .fa-cb').last().click(); await submit(); await p.waitForTimeout(2300);
  ok((await banner()).includes('שלחנו מייל אימות'), 'sign-up shows "confirmation e-mail sent" and moves to sign-in');
  ok((await inputs().nth(0).inputValue()) === 'dana@example.com', 'e-mail is prefilled on the sign-in screen');

  console.log('2. sign in before confirming');
  await inputs().nth(1).fill('Cold-Water-2026'); await submit(); await p.waitForTimeout(1500);
  ok((await banner()).includes('לאשר את כתובת האימייל'), 'unconfirmed account is told to confirm the e-mail');

  console.log('3. confirm, then sign in');
  await get('/__confirm/dana@example.com');
  await inputs().nth(1).fill('Cold-Water-2026'); await submit(); await p.waitForTimeout(2600);
  ok((await userNow()) === 'dana@example.com', 'signed in after confirming');
  ok((await nameNow()) === 'דנה כהן', 'name comes from the server profile');
  ok(await p.evaluate(() => document.documentElement.dataset.auth === 'user'), 'header shows the signed-in avatar');

  console.log('4. session survives a restart');
  await p.reload(); await p.waitForTimeout(2500);
  ok((await userNow()) === 'dana@example.com' && (await p.locator('#fx-auth').count()) === 0, 'still signed in after reload, no sign-in screen');

  console.log('5. edit name (saved on the server)');
  await openAccount(); await p.getByRole('button', { name: /פרטים אישיים/ }).click(); await p.waitForTimeout(700);
  await p.locator('#fx-account input.fa-input').fill('דנה לוי'); await p.locator('#fx-account button[type=submit]').click(); await p.waitForTimeout(1800);
  ok((await nameNow()) === 'דנה לוי', 'name updated in the app');
  await p.evaluate(() => { localStorage.removeItem('nexa-auth:session'); sessionStorage.removeItem('nexa-auth:session'); });   // forget the local copy: the server must supply it next time
  await p.reload(); await p.waitForTimeout(2300);
  ok((await p.locator('#fx-auth').count()) === 1, 'without the local copy the app asks to sign in again');
  await inputs().count();
  await p.getByRole('button', { name: 'כבר יש לי חשבון' }).click(); await p.waitForTimeout(800);
  await inputs().nth(0).fill('dana@example.com'); await inputs().nth(1).fill('Cold-Water-2026'); await submit(); await p.waitForTimeout(2500);
  ok((await nameNow()) === 'דנה לוי', 'the new name was really stored on the server');

  console.log('6. change password');
  await openAccount(); await p.getByRole('button', { name: /שינוי סיסמה/ }).click(); await p.waitForTimeout(700);
  const cp = p.locator('#fx-account input.fa-input');
  await cp.nth(0).fill('wrong-password1'); await cp.nth(1).fill('Colder-Water-2027'); await p.locator('#fx-account button[type=submit]').click(); await p.waitForTimeout(1500);
  ok((await p.locator('#fx-account .fa-err').allTextContents()).join('').includes('הסיסמה שגויה'), 'wrong current password is rejected');
  await cp.nth(0).fill('Cold-Water-2026'); await p.locator('#fx-account button[type=submit]').click(); await p.waitForTimeout(2000);
  ok((await p.locator('.fa-toast').last().textContent()).includes('הסיסמה עודכנה'), 'password changed');

  console.log('7. sign out, old password fails, new one works');
  await p.getByRole('button', { name: 'התנתקות' }).click().catch(async () => { await openAccount(); await p.getByRole('button', { name: 'התנתקות' }).click(); });
  await p.waitForTimeout(1500);
  ok((await p.locator('#fx-auth').count()) === 1 && (await userNow()) === null, 'signed out → sign-in screen');
  ok((await get('/__log')).some((l) => l.includes('/auth/v1/logout')), 'the server was told to end the session');
  await p.getByRole('button', { name: 'כבר יש לי חשבון' }).click(); await p.waitForTimeout(800);
  await inputs().nth(0).fill('dana@example.com'); await inputs().nth(1).fill('Cold-Water-2026'); await submit(); await p.waitForTimeout(1500);
  ok((await banner()).includes('האימייל או הסיסמה שגויים'), 'old password no longer works');
  await inputs().nth(1).fill('Colder-Water-2027'); await submit(); await p.waitForTimeout(2500);
  ok((await userNow()) === 'dana@example.com', 'new password works');

  console.log('8. forgot password with an e-mailed code');
  await openAccount(); await p.getByRole('button', { name: 'התנתקות' }).click(); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'כבר יש לי חשבון' }).click(); await p.waitForTimeout(800);
  await inputs().nth(0).fill('dana@example.com');
  await p.getByRole('button', { name: 'שכחתם סיסמה?' }).click(); await p.waitForTimeout(800);
  await submit(); await p.waitForTimeout(1500);
  ok((await p.locator('#fx-auth .fa-demo-code').count()) === 0, 'no demo code is shown (the code goes by e-mail)');
  ok((await banner()).includes('שלחנו קוד'), '"we sent a code" is shown');
  const rs = inputs();
  await rs.nth(0).fill('000000'); await rs.nth(1).fill('Reset-Pass-2028'); await submit(); await p.waitForTimeout(1500);
  ok((await p.locator('#fx-auth .fa-err').allTextContents()).join('').includes('הקוד שגוי'), 'wrong code is rejected');
  const { code } = await get('/__codes/dana@example.com');
  await rs.nth(0).fill(code); await submit(); await p.waitForTimeout(2800);
  ok((await userNow()) === 'dana@example.com', 'correct code + new password signs you in');

  console.log('9. access token expires and is refreshed');
  await post('/__config', { ttl: 3 });
  await openAccount(); await p.getByRole('button', { name: 'התנתקות' }).click(); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'כבר יש לי חשבון' }).click(); await p.waitForTimeout(800);
  await inputs().nth(0).fill('dana@example.com'); await inputs().nth(1).fill('Reset-Pass-2028'); await submit(); await p.waitForTimeout(2600);
  await sleep(4000);
  await openAccount(); await p.getByRole('button', { name: /פרטים אישיים/ }).click(); await p.waitForTimeout(700);
  await p.locator('#fx-account input.fa-input').fill('דנה ברק'); await p.locator('#fx-account button[type=submit]').click(); await p.waitForTimeout(2000);
  ok((await nameNow()) === 'דנה ברק', 'an expired token was refreshed and the change went through');
  ok((await get('/__log')).some((l) => l.includes('grant_type=refresh_token')), 'the refresh endpoint was used');
  await post('/__config', { ttl: 3600 });

  console.log('10. duplicate sign-up');
  await p.locator('#fx-account .fa-icon-btn[aria-label="סגירה"]').first().click().catch(() => {}); await p.waitForTimeout(500);
  await openAccount(); await p.getByRole('button', { name: 'התנתקות' }).click(); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'יצירת חשבון' }).click(); await p.waitForTimeout(900);
  await inputs().nth(0).fill('Someone'); await inputs().nth(1).fill('dana@example.com'); await inputs().nth(2).fill('Another-Pass-1');
  await p.locator('#fx-auth .fa-cb').last().click(); await submit(); await p.waitForTimeout(2000);
  ok((await banner()).includes('כבר קיים חשבון'), 'an existing e-mail is reported as already registered');

  console.log('11. offline');
  await p.getByRole('button', { name: 'להתחברות' }).first().click().catch(() => {}); await p.waitForTimeout(600);
  await p.route('**/auth/v1/**', (r) => r.abort());
  await inputs().nth(0).fill('dana@example.com'); await inputs().nth(1).fill('Reset-Pass-2028'); await submit(); await p.waitForTimeout(1500);
  ok((await banner()).includes('אין חיבור לשרת'), 'no connection shows a clear message');
  await p.unroute('**/auth/v1/**');
  await submit(); await p.waitForTimeout(2500);
  ok((await userNow()) === 'dana@example.com', 'works again when the connection returns');

  console.log('12. account deleted on the server');
  await p.reload(); await p.waitForTimeout(2300);
  await get('/__drop/dana@example.com');
  await p.reload(); await p.waitForTimeout(2800);
  ok((await p.locator('#fx-auth').count()) === 1 && (await userNow()) === null, 'a session whose account is gone sends you back to sign in');

  console.log('13. delete my account from the app');
  await p.getByRole('button', { name: 'יצירת חשבון' }).click(); await p.waitForTimeout(900);
  await post('/__config', { confirm: false });
  await inputs().nth(0).fill('Noam'); await inputs().nth(1).fill('noam@example.com'); await inputs().nth(2).fill('Delete-Me-2026');
  await p.locator('#fx-auth .fa-cb').last().click(); await submit(); await p.waitForTimeout(2800);
  ok((await userNow()) === 'noam@example.com', 'with confirmation OFF, sign-up signs you in immediately');
  await openAccount(); await p.getByRole('button', { name: 'מחיקת החשבון' }).click(); await p.waitForTimeout(700);
  await p.locator('#fx-account input.fa-input').fill('bad-password'); await p.locator('#fx-account button[type=submit]').click(); await p.waitForTimeout(1500);
  ok((await p.locator('#fx-account .fa-err').allTextContents()).join('').includes('הסיסמה שגויה'), 'delete asks for the right password');
  await p.locator('#fx-account input.fa-input').fill('Delete-Me-2026'); await p.locator('#fx-account button[type=submit]').click(); await p.waitForTimeout(2600);
  ok((await p.locator('#fx-auth').count()) === 1 && (await userNow()) === null, 'account deleted → back to the welcome screen');
  ok((await get('/__log')).some((l) => l.includes('rpc/delete_my_account')), 'the delete function was called on the server');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
