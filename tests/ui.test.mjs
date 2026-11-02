// What the player sees (src/ui.ts, style.css): the reading note under their line, its other readings, the question popup,
// the kind colours and the period type. Run with a stand-in document, so it needs no browser; SillyTavern draws the same
// elements.
import fs from 'node:fs';
const U = await import('../src/ui.js');
const A = await import('../src/rules/ask.js');
const R = await import('../src/rules/reading.js');
const ROOT = new URL('..', import.meta.url).pathname;
let miss = 0, n = 0;
const ok = (c, m, got = '') => { n++; if (!c) { miss++; console.log(`MISS ${m}${got ? `: ${got}` : ''}`); } };

// A stand-in document: elements keep their children, attributes, listeners and text; setting innerHTML is counted, since the
// note's words are the player's and the model's and are set as text only.
let htmlSet = 0;
const el = tag => {
    const e = { tag, className: '', textContent: null, title: '', type: undefined, children: [], attrs: {}, on: {},
        appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (this.on[t] ??= []).push(f); },
        click() { for (const f of this.on.click ?? []) f(); } };
    Object.defineProperty(e, 'innerHTML', { set() { htmlSet++; }, get() { return ''; } });
    return e;
};
const doc = { createElement: el, createTextNode: t => ({ ...el('#text'), textContent: t }) };
const all = (e, out = []) => { out.push(e); for (const c of e.children) all(c, out); return out; };
const byClass = (e, c) => all(e).filter(x => x.className.split(' ').includes(c));
const text = e => e.children.length ? e.children.map(text).join('') : e.textContent ?? '';

// U1: each call is one line, a tag naming its kind of rule and the call in the fewest words, the player's character left out
// (it makes every call shown); things read are tagged Thing; the guess is shown lowercased, with the others only while the
// line is the player's latest; a correction's note loses its framing.
const calls = [{ tool: 'Act', args: { who: 'Ann', action: 'walks after Tom', distance_m: 12 } }, { tool: 'Look', args: { viewer: 'Ann', target: 'Tom', distance_m: 12 } },
    { tool: 'Communicate', args: { speaker: 'Ann', listener: 'the guard', effort: 'whisper', message: 'Open the gate' } }];
const acts = R.readingItems(calls, 'Ann');
const note = { redone: 'The player corrects their last line: it meant Will.', taken: { label: 'Walk after Tom in the open', others: ['Catch up with Tom', 'Keep behind Tom, out of sight'] },
    acts, things: ['lamp → Argand lamp (1780)'] };
const v = U.noteView(note, true), old = U.noteView(note, false);
const rows = v.rows.map(r => `${r.tag} ${r.text}`);
ok(JSON.stringify(rows) === JSON.stringify(['Move walks after Tom · 12 m', 'Sight Tom · 12 m', 'Speech whisper → the guard: “Open the gate”', 'Thing lamp → Argand lamp (1780)']) && !rows.some(r => /Ann/.test(r)),
    'tagged rows, actor left out', JSON.stringify(rows));
ok(v.taken === 'walk after Tom in the open' && v.redone === 'it meant Will' && JSON.stringify(v.alts?.lines) === JSON.stringify(['no, catch up with Tom', 'no, keep behind Tom, out of sight']) && !old.alts,
    'guess and others on the latest line only', JSON.stringify([v.taken, v.redone, v.alts, old.alts]));
ok(U.noteView({ acts: [], things: [] }, true) === null && R.kindOf('BodyStrike') === 'body' && R.kindOf('Listen') === 'sound' && R.kindOf('PassTime') === 'time', 'an empty reading draws nothing; kinds');
// An older note, kept before kinds were stored, still gets its tag from the call.
ok(U.noteView({ acts: [{ text: 'Ann looks at Tom', detail: 'Look: viewer Ann, target Tom' }], things: [] }, true).rows[0].tag === 'Sight', 'old note tagged from its call');

// U2: drawn, the note is a <details> folded to one line (the guess with "or…", then each tag and its words), opened to one
// row per call with the call as hover text and the others as linked words, each filling the message box with its
// correction; every word is set as text (markup in a name stays letters); the era and the tone are on the element.
let filled = null;
const evil = U.noteView({ acts: [{ text: 'x', brief: '<img src=x onerror=alert(1)>', detail: 'Look: target <img>', kind: 'sight' }], things: [], taken: { label: 'Hit <b>Tom</b>', others: ['Hit Will'] } }, true);
const box = U.drawNote(doc, v, { era: 'c19', tone: 'dark' }, t => { filled = t; });
const sum = byClass(box, 'rules-reading-sum')[0], alts = byClass(box, 'rules-reading-alts')[0];
const links = byClass(alts ?? el('x'), 'rules-link');
ok(box.tag === 'details' && /rules-era-c19/.test(box.className) && box.attrs['data-tone'] === 'dark' && sum?.tag === 'summary', 'folded details with era and tone', `${box.tag} ${box.className}`);
ok(/^Redone: it meant Will☞ walk after Tom in the open— or…Move walks after Tom · 12 mSight Tom · 12 m/.test(text(sum)) && byClass(sum, 'rules-reading-or').length === 1, 'folded line', text(sum));
ok(text(alts) === 'Or did you mean to catch up with Tom or keep behind Tom, out of sight?' && links.length === 2, 'others as linked words', text(alts));
links[1]?.click();
ok(filled === 'no, keep behind Tom, out of sight' && all(box).some(x => x.title === 'Look: viewer Ann, target Tom, distance_m 12'), 'link fills the line; call on hover', String(filled));
const evilBox = U.drawNote(doc, evil, { era: 'now', tone: 'light' }, () => {});
ok(htmlSet === 0 && text(evilBox).includes('<img src=x onerror=alert(1)>') && /→ hit <b>Tom<\/b>/.test(text(evilBox)), 'note drawn as text', `${htmlSet} innerHTML sets`);
const tags = byClass(box, 'rules-tag').map(t => `${t.textContent}:${t.className.split(' ').find(c => c.startsWith('rules-k-'))}`);
ok(tags.includes('Sight:rules-k-sense') && tags.includes('Speech:rules-k-speech') && tags.includes('Thing:rules-k-thing') && tags.includes('Move:rules-k-move'), 'tags carry word and colour family', tags.join());

// U3: notes are kept on the player's messages and offer the others on the latest only; a narrator's message holding the key
// is not a player's line; a line edited since its reading shows none.
const chat = [{ is_user: true, mes: 'I follow Tom.', extra: { rulesReading: { ...note, line: 'I follow Tom.' } } }, { is_user: false, extra: { rulesReading: note } },
    { is_user: true, mes: 'I hit him.', extra: { rulesReading: note } }, { is_user: false }, { is_user: true, mes: 'I follow Will.', extra: { rulesReading: { ...note, line: 'I follow Tom.' } } }];
const drawn = U.notesOf(chat), drawnOld = U.notesOf(chat.slice(0, 4));
ok(JSON.stringify(drawn.map(d => d.index)) === '[0,2]' && !drawn[1].view.alts && !!drawnOld[1].view.alts && !drawnOld[0].view.alts, 'notes on player lines, others on the latest', JSON.stringify([drawn.map(d => d.index), drawnOld.map(d => [d.index, !!d.view.alts])]));

// U4: the question is a sentence: the player's words, then the choices linked alike and numbered, the words they share said
// once ("hit Tom or Will"); no OK, Cancel or other buttons, the sentence holding the focus (Enter picks nothing); clicks and
// number keys pick, "Say it another way" returns none.
const p = U.askPopup({ said: 'Hit <him>', choices: ['Hit Tom', 'Hit Will'] }, { era: 'c17', reduced: true });
const choiceTags = [...p.content.matchAll(/<button[^>]*rules-ask-choice[^>]*>/g)].map(m => m[0].replace(/data-choice="[^"]*"/, ''));
ok(/Do you mean to hit <button[^>]*><sup>1<\/sup>Tom<\/button> or <button[^>]*><sup>2<\/sup>Will<\/button>\?/.test(p.content) && new Set(choiceTags).size === 1 && choiceTags.length === 3,
    'choices in one sentence, alike', p.content);
ok(/<p class="rules-ask-prose" tabindex="-1" autofocus>/.test(p.content) && /“Hit &#60;him&#62;”/.test(p.content) && /rules-era-c17/.test(p.content) && p.options.okButton === false && p.options.cancelButton === false && !p.options.customButtons && p.options.animation === 'none',
    'no default; words escaped; period; still', p.content);
const done = [], keys = {}, fakes = ['0', '1', 'other'].map(c => ({ c, on: {}, getAttribute() { return this.c; }, addEventListener(t, f) { this.on[t] = f; } }));
p.options.onOpen({ dlg: { addEventListener: (t, f) => { keys[t] = f; }, querySelectorAll: () => fakes }, complete: r => done.push(r) });
fakes[1].on.click(); fakes[2].on.click();
for (const key of ['1', '3', 'Enter']) keys.keydown?.({ key, preventDefault() {} });
ok(JSON.stringify(done) === JSON.stringify([11, U.OTHER, 10]), 'clicks and number keys pick', JSON.stringify(done));
ok(U.askAnswer(11, 2) === 1 && U.askAnswer(U.OTHER, 2) === null && U.askAnswer(null, 2) === null && U.askAnswer(12, 2) === null, 'answers map back');
const things = U.askPopup({ said: 'lamp', choices: ['Argand lamp (1780)', 'oil lamp'], notes: ['a <hollow> wick', 'a wick in oil'], things: true });
ok(/Do you mean <button[^>]*><sup>1<\/sup>Argand lamp \(1780\)<\/button> <span class="rules-ask-note">\(a &#60;hollow&#62; wick\)<\/span> or <button/.test(things.content), 'things with their descriptions', things.content);
const sh = U.shared(['Catch up with Tom', 'Keep behind Tom, out of sight', 'Walk after Tom in the open']), sh2 = U.shared(['Look at Tom', 'Look at Will']);
ok(sh.lead === '' && sh.items[0] === 'catch up with Tom' && sh2.lead === 'look at' && sh2.items.join() === 'Tom,Will' && U.saidOf('"Follow the thief": which do you mean?') === 'Follow the thief', 'shared words said once', JSON.stringify([sh, sh2]));

// U5: each reading not taken, sent as its line, is read back as that reading (ask.ts correctionOf, correctionFix).
const has = () => true, ppl = [{ name: 'the thief' }, { name: 'Tom', sex: 'male' }, { name: 'Will', sex: 'male' }];
const round = [];
for (const line of ['I follow the thief through the market.', 'I take the bridge.', 'I hit him.']) {
    const q = A.openQuestion(line, 'Jack', ppl, has);
    for (const o of q?.options ?? []) {
        const last = o.fix.tool ? [{ tool: o.fix.tool, args: { attacker: 'Jack', [o.fix.arg]: q.options.find(x => x !== o).fix.value } }] : [];
        const f = A.correctionFix(A.correctionOf(A.correctionLine(o.label)) ?? '', line, 'Jack', ppl, last, has);
        const same = f && (o.fix.require ? f.require === o.fix.require : f.tool === o.fix.tool && f.arg === o.fix.arg && f.value === o.fix.value);
        if (!same) round.push(`${line} / ${o.label} → ${JSON.stringify(f)}`);
    }
}
ok(round.length === 0, 'change lines read back as their reading', round.join('; '));

// U6: the era from the story's year (the type a book of that time was set in), the mark for a guess, the theme's tone.
const eras = [1500, 1599, 1600, 1749, 1750, 1799, 1800, 1919, 1920, 1969, 1970, null].map(U.eraOf).join();
ok(eras === 'c16,c16,c17,c17,c18,c18,c19,c19,c20,c20,now,now' && U.markOf('c19') === '☞' && U.markOf('now') === '→' && U.toneOf('rgb(220, 220, 210)') === 'dark' && U.toneOf('rgba(30, 30, 30, 1)') === 'light', 'era, mark and tone', eras);

// U7: every kind's colour, as style.css mixes it with the theme's text colour, reads at 4.5:1 or more (WCAG 1.4.3) on each of
// SillyTavern's shipped themes (default/content/themes: text, chat tint and user message tint over black) and on a light
// theme; the hues are Okabe & Ito's.
const css = fs.readFileSync(`${ROOT}/style.css`, 'utf8');
const rgba = s => s.match(/[\d.]+/g).map(Number), hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const over = (t, b) => [0, 1, 2].map(i => t[i] * (t[3] ?? 1) + b[i] * (1 - (t[3] ?? 1)));
const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const THEMES = { dark: [['Azure', 'rgba(171, 198, 223, 1)', 'rgba(23, 23, 23, 0)', 'rgba(0, 28, 174, 0.2)'], ['Cappuccino', 'rgba(235, 235, 235, 1)', 'rgba(50, 45, 50, 0.75)', 'rgba(34, 30, 32, 0.75)'],
    ['Celestial Macaron', 'rgba(229, 175, 162, 1)', 'rgba(18, 26, 40, 0.9)', 'rgba(51, 67, 90, 0.7)'], ['Dark Lite', 'rgba(220, 220, 210, 1)', 'rgba(23, 23, 23, 1)', 'rgba(30, 30, 30, 0.9)'],
    ['Dark V 1.0', 'rgba(207, 207, 197, 1)', 'rgba(29, 33, 40, 0.9)', 'rgba(29, 33, 40, 0.9)']], light: [['light', 'rgba(30, 30, 30, 1)', 'rgba(243, 241, 234, 1)', 'rgba(255, 255, 255, 0.5)']] };
const OKABE_ITO = ['#56B4E9', '#009E73', '#D55E00', '#E69F00', '#CC79A7', '#F0E442', '#0072B2'];
const shares = [...css.matchAll(/\[data-tone="(dark|light)"\] \.rules-k-(\w+) \{ color: color-mix\(in srgb, (#[0-9A-F]{6}) (\d+)%, var\(--SmartThemeBodyColor\)\); \}/g)];
const low = [];
for (const [, tone, fam, h, pct] of shares) for (const [name, body, chat, user] of THEMES[tone]) {
    const bg = over(rgba(user), over(rgba(chat), [0, 0, 0])), b = rgba(body), c = [0, 1, 2].map(i => hex(h)[i] * pct / 100 + b[i] * (1 - pct / 100));
    const r = contrast(c, bg); if (r < 4.5) low.push(`${tone} ${fam} on ${name}: ${r.toFixed(2)}`);
}
const fams = new Set(Object.values(U.FAMILY));
ok(shares.length === 14 && low.length === 0 && shares.every(s => OKABE_ITO.includes(s[3])) && [...fams].every(f => shares.filter(s => s[2] === f).length === 2), 'kind colours legible on every theme', `${shares.length} rules; ${low.join('; ')}`);

// U8: each period face style.css loads is in fonts/, each family has its licence, and no face is named with a Reserved Font
// Name (Libre Baskerville's subset is renamed, as the OFL asks of modified versions).
const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map(m => m[1]), missing = urls.filter(u => !fs.existsSync(`${ROOT}/${u}`));
const licences = ['EBGaramond', 'IMFellEnglish', 'LibreBaskerville', 'OldStandard', 'LibreCaslonText'].filter(l => !fs.existsSync(`${ROOT}/fonts/OFL-${l}.txt`));
const families = [...css.matchAll(/font-family: '([^']+)'/g)].map(m => m[1]);
ok(urls.length === 10 && !missing.length && !licences.length && !families.some(f => /Libre Baskerville/.test(f)), 'period faces present, licensed, renamed', `${missing.join()} ${licences.join()} ${families.join()}`);

// P1: the player's marks read in code (src/rules/prosody.ts): each word with its marks and pauses, the feeling a ((…)) names,
// the line without its marks for reading its verbs, the effort the marks fix, the delivery in a few words.
const P = await import('../src/rules/prosody.js');
const line = '((angry)) "STOP looking at me, (.) who do you ↑think I am? You literally cannot keep your eyes off ˈme."';
const pr = P.readProsody(line), mk = w => pr.words.find(x => x.word.replace(/[^\p{L}]/gu, '').toLowerCase() === w)?.marks ?? [];
ok(pr.feeling === 'anger' && pr.plain === '"Stop looking at me, who do you think I am? You literally cannot keep your eyes off me."' && mk('stop').includes('loud') && mk('think').includes('up')
    && pr.words.find(x => /^me,/.test(x.word))?.pause === 0.1 && P.effortOf(pr) === 'raised', 'marks read in code', JSON.stringify(pr.words.filter(x => x.marks.length || x.pause)));
ok(P.deliveryOf(pr) === 'feeling: anger · louder: Stop · pitch up on think · stressed: me · short pause after me', 'delivery in few words', P.deliveryOf(pr));
const voqs = P.readProsody('I whisper to Tom, "{W meet me at the gate W}" .hhh {V̤ please V̤} hhh ☺fine☺ °no° Sto- wo::rd la(h)ter (0.5)');
const vm = w => voqs.words.find(x => x.word.replace(/[^\p{L}]/gu, '').toLowerCase() === w)?.marks ?? [];
ok(P.effortOf(voqs) === 'whisper' && vm('gate').includes('whisper') && vm('please').join() === 'inbreath,breathy,outbreath' && vm('fine').includes('smile') && vm('no').includes('quiet')
    && vm('sto').includes('cut') && vm('word').includes('stretch') && vm('later').includes('laugh') && voqs.words.at(-1).pause === 0.5, 'every mark read', JSON.stringify(voqs.words.map(x => [x.word, x.marks])));
// P2: ordinary text reads as it is: currency, times, a temperature, hyphenated words, a colon before speech, single
// parentheses, abbreviations in capitals, a plain sentence.
const plainLines = ['It cost £5 at 3:30, a well-known man said: (laughs) OK, the FBI was at 30° today.', 'Mr. Smith - no, I said "fine".', 'I hit him.', 'Shh, quiet! Hmm. I saw the USA team on TV.', '<b>bold</b> and (aside) text', 'We flew back to the US at 9 AM.'];
const moved = plainLines.filter(l => { const x = P.readProsody(l); return x.marked || x.plain !== l || x.words.some(w => w.marks.length); });
ok(moved.length === 0, 'ordinary text unread', moved.join(' | '));
// P3: no signs on screen (src/rules/voice-code.ts): every choice of the toolbar marks the word with hidden codes; the words
// shown stay the player's own, exactly; the engine reads the mark back on that word from its codes;
// choosing it again takes it off; quotation marks and punctuation stay where they were; a feeling replaces the line's last.
const VC = await import('../src/rules/voice-code.js');
const back = [], ids = U.VOICE_GROUPS.flatMap(g => g.items.map(i => i.id)).filter(i => !i.startsWith('feeling:'));
for (const id of ids) {
    const text = '"Stop looking at me," she said.', at = text.indexOf('looking') + 2;
    const r = VC.markWords(text, at, at, id), out = r ? text.slice(0, r.from) + r.insert + text.slice(r.to) : text;
    const x = VC.marksOf(out), word = x.words.find(w => /looking/i.test(w.word));
    const got = id === 'micro' || id === 'pause' ? word?.pause > 0 : (word?.marks ?? []).includes(id);
    const r2 = VC.markWords(out, at, at, id), off = r2 ? out.slice(0, r2.from) + r2.insert + out.slice(r2.to) : out;
    if (!got || VC.visible(out) !== text || off !== text) back.push(`${id}: ${VC.toNotation(out)} → ${JSON.stringify(word)}; off ${off === text}`);
}
const fA = VC.markWords('I go.', 0, 0, 'feeling:anger'), tA = fA.insert + 'I go.'.slice(fA.to), fB = VC.markWords(tA, 0, 0, 'feeling:fear'), tB = fB.insert + tA.slice(fB.to);
ok(back.length === 0 && ids.length === 19 && VC.marksOf(tB).feeling === 'fear' && VC.visible(tB) === 'I go.' && !/\(\(/.test(VC.visible(tB)), 'each toolbar choice marks its word unseen and reads back', back.join(' | ') + ` ${VC.toNotation(tB)}`);
// A selection marks every word it touches; a word with no letter takes none; the caret between words marks nothing.
const sel = VC.markWords('"one two," three', 1, 8, 'quiet'), selT = sel.insert, selN = VC.toNotation('"one two," three'.slice(0, sel.from) + selT + '"one two," three'.slice(sel.to));
ok(selN === '"°one two°," three' && VC.markWords('a  b', 2, 2, 'stress') === null && VC.markWords('— !', 0, 3, 'loud') === null, 'a selection marks every word; nothing between words', selN);
// P3b: Backspace and Delete take a marked letter as one character; a word left with no letter loses its marks.
const mk1 = (t, w, id) => { const i = t.indexOf(w) + 1, r = VC.markWords(t, i, i, id); return t.slice(0, r.from) + r.insert + t.slice(r.to); };
const apply = (s, r) => s.slice(0, r.from) + r.insert + s.slice(r.to), caretOf = r => r.from + r.insert.length;
const tm = mk1('at me, now', 'me', 'loud'), d1 = VC.keyDelete(tm, tm.indexOf(','), true), after1 = apply(tm, d1);
const d2 = VC.keyDelete(after1, caretOf(d1), true), after2 = apply(after1, d2);
const tf = mk1('a me b', 'me', 'up'), df = VC.keyDelete(tf, 3, false), afterF = apply(tf, df);
const ti = mk1('a I b', 'I', 'up'), di = VC.keyDelete(ti, 2, false), afterI = apply(ti, di);
ok(VC.visible(after1) === 'at m, now' && VC.tokens(after1).find(k => k.word === 'm,')?.codes.join() === 'L' && after2 === 'at , now' && VC.visible(afterF) === 'a m b' && VC.tokens(afterF).find(k => k.word === 'm')?.codes.join() === 'U'
    && afterI === 'a  b' && VC.keyDelete(tf, 2, false) === null && VC.keyDelete('plain', 3, true) === null && d1.from === tm.indexOf('me') + 1 && d1.to === tm.indexOf(','),
    'backspace takes a marked letter whole', JSON.stringify([VC.visible(after1), after2, VC.visible(afterF), afterI]));
// P3c: the box's layer holds the box's text exactly (each letter where the box has it), marked words in their group's
// colour; the chat's typesetting gives each marked word its marks' classes and adds the pause's dot and the feeling.
let line2 = '"Stop looking at me, who do you think I am?"';
for (const [w, id] of [['Stop', 'loud'], ['me,', 'micro'], ['think', 'up'], ['Stop', 'feeling:anger']]) line2 = mk1(line2, w, id);
const parts = U.mirrorParts(line2);
const typed = U.drawVoice(doc, line2), cls = typed.filter(x => x.className).map(x => `${x.className}:${x.textContent}`);
ok(parts.map(p => p.text).join('') === line2 && parts.find(p => p.family)?.family === 'body' && parts.filter(p => p.family).length === 3
    && cls.join('|') === 'rules-v-add rules-v-add-feeling:angrily|rules-v rules-v-loud:Stop|rules-v-add rules-v-add-micro: ·|rules-v rules-v-up:think' && typed.map(x => x.textContent).join('') === 'angrily "Stop looking at me, · who do you think I am?"',
    'box layer and chat typesetting', JSON.stringify([parts.map(p => p.family ?? '-').join(','), cls, typed.map(x => x.textContent).join('')]));
// The notation a model reads, and the reading of the voice, from a line marked unseen.
ok(VC.toNotation(line2) === '((angry)) "STOP looking at me, (.) who do you ↑think I am?"' && VC.toNotation('plain words') === 'plain words', 'unseen marks become the notation', VC.toNotation(line2));

// P4: the feeling heard in a voice: Juslin & Laukka 2003 Table 4's unweighted mean pi, within and across cultures, read as
// the share right among five feelings (pi = p(k − 1)/(1 + p(k − 2)) solved for p).
const pi = JSON.stringify(P.VOCAL_PI), five = P.heardRight('anger', true), back5 = five * 4 / (1 + five * 3);
ok(pi === '{"anger":[0.93,0.91],"fear":[0.88,0.82],"happiness":[0.87,0.74],"sadness":[0.93,0.91],"tenderness":[0.82,0.71]}' && Math.abs(back5 - 0.93) < 1e-9 && Math.abs(five - 0.7686) < 1e-3 && P.heardRight('happiness', false) < P.heardRight('happiness', true),
    'feeling heard at the measured rate', `${pi} ${five}`);
// R10: typed signs after an opening quotation mark or bracket are read (the first word of speech), VoQS braces with a bracket
// clinging to them too; one colon between letters is ordinary writing.
const q1 = P.readProsody('I tell him, "↑Stop that, °please°." \'({W meet me W})\' I read Re:Zero.'), qm = w => q1.words.find(x => x.word.replace(/[^\p{L}]/gu, '') === w)?.marks ?? [];
ok(qm('Stop').includes('up') && qm('please').includes('quiet') && qm('meet').includes('whisper') && qm('me').includes('whisper') && !qm('ReZero').length && /Re:Zero/.test(q1.plain) && !/\{W|W\}/.test(q1.plain), 'typed signs after a quotation mark', JSON.stringify(q1.words.filter(x => x.marks.length)));
// R11: Backspace after a marked one-letter word in quotes takes its marks with it.
{
  const VCb = await import('../src/rules/voice-code.js');
  const r = VCb.markWords('"I"', 1, 1, 'up'), t = '"I"'.slice(0, r.from) + r.insert + '"I"'.slice(r.to), d = VCb.keyDelete(t, t.length - 1, true), after = t.slice(0, d.from) + d.insert + t.slice(d.to);
  ok(after === '""', 'Backspace in quotes takes the marks', JSON.stringify(after));
}
// R26: a word left with no letter or digit loses its marks whatever punctuation stays ("I—", "I…", "«I»", "[I]"); one that
// keeps a letter keeps them ("U.S.A." less its A, "x—I" less its I).
{
  const del = (t, w, back) => { const m = mk1(t, w, 'up'), i = m.indexOf(w) + (back ? w.length : 0), at = back ? m.slice(i).search(/[^\u{E0020}-\u{E007F}]|$/u) + i : i, d = VC.keyDelete(m, at, back); return d ? apply(m, d) : null; };
  const gone = [['I—', 'I', true], ['I…', 'I', true], ['«I»', 'I', true], ['[I]', 'I', false], ['go I—', 'I', false]].map(([t, w, b]) => del(t, w, b));
  const kept = [['U.S.A.', 'A', true], ['x—I', 'I', true]].map(([t, w, b]) => del(t, w, b));
  ok(gone.every(x => x !== null && !VC.hasHidden(x)) && JSON.stringify(gone) === '["—","…","«»","[]","go —"]' && kept.every(x => x && VC.hasHidden(x) && VC.tokens(x)[0].codes.join() === 'U'),
      'a word with no letter left loses its marks', JSON.stringify([gone, kept.map(x => x && VC.toNotation(x))]));
}
// R27: VoQS braces a dash or an ellipsis clings to are read as braces ('"Wait—{W not now W}," she says', '—{W go W}…');
// braces with the label glued to a word are no span ("{WhelloW}", as "{Fred}" is none) and stay as typed.
{
  const a = P.readProsody('"Wait—{W not now W}," she says.'), b = P.readProsody('—{W go away W}…'), c = P.readProsody('"{WhelloW}"');
  const wh = p => p.words.filter(w => w.marks.includes('whisper')).map(w => w.word.replace(/[^\p{L}]/gu, '')).join(' ');
  ok(wh(a) === 'not now' && !/\{W|W\}/.test(a.plain) && /Wait—/.test(a.plain) && wh(b) === 'go away' && b.plain === '—go away…' && c.plain === '"{WhelloW}"' && !c.marked,
      'VoQS braces with a dash clinging', JSON.stringify([a.plain, wh(a), b.plain, wh(b), c.plain]));
}
// R28: a timed pause is titled by its own length (the toolbar's is half a second).
{
  const title = code => U.drawVoice(doc, 'Wait' + VC.block([code]) + ' now').find(x => x.className?.includes('rules-v-add-pause'))?.title;
  ok(title('p2') === 'pause, 2 s' && title('p0.5') === 'pause, half a second', 'a pause titled by its length', JSON.stringify([title('p2'), title('p0.5')]));
}
// R29: capitals spelling a pronoun, a conjunction or an auxiliary after a determiner are an abbreviation ("the WHO", "the IT
// desk", "the OR"), and LA, DC, HR, PR, ER are listed; without a determiner a pronoun in capitals is said louder.
{
  const loud = l => P.readProsody(l).words.filter(w => w.marks.includes('loud')).map(w => w.word.replace(/[^\p{L}]/gu, '')).join(',');
  const quiet = ['the WHO says so.', 'I sit at the IT desk.', 'They wheel him into the OR.', 'I called the ER.', 'I flew to LA.', 'I work in HR.'].filter(l => loud(l));
  ok(!quiet.length && loud('WHO did this?') === 'Who' && loud('Get IT away!') === 'it' && loud('"MA! Come here!"') === 'Ma' && loud('the BIG dog') === 'big' && P.readProsody('the WHO says so.').plain === 'the WHO says so.',
      'abbreviations after a determiner', JSON.stringify([quiet, loud('WHO did this?'), loud('Get IT away!')]));
}
// R30: the words the typesetting adds are not selected with the line, so a line copied from the chat is the player's own.
{
  const css = fs.readFileSync(`${ROOT}/style.css`, 'utf8');
  ok(/\.rules-v-add\s*\{[^}]*(?<!-webkit-)user-select:\s*none/.test(css) && /\.rules-v-add\s*\{[^}]*-webkit-user-select:\s*none/.test(css), 'added voice words left out of a copied line');
}
// R12: the ♪ button is a button from the keyboard (Enter, Space), and the toolbar stays open while it holds the focus.
{
  const js = fs.readFileSync(`${ROOT}/src/index.js`, 'utf8');
  ok(/note\.setAttribute\('role', 'button'\)/.test(js) && /e\.key === 'Enter' \|\| e\.key === ' '/.test(js) && /bar\.contains\(focus\)/.test(js), 'voice button works from the keyboard');
}
// R20: "Say it another way" takes the line back: the chat's last line, the player's, returns to the input box with its marks.
{
  const back = U.lineToTakeBack([{ is_user: false, mes: 'Tom and Will stand there.' }, { is_user: true, mes: 'I hit him.' }]);
  const js = fs.readFileSync(`${ROOT}/src/index.js`, 'utf8');
  ok(back?.index === 1 && back.text === 'I hit him.' && U.lineToTakeBack([{ is_user: true, mes: 'x' }, { is_user: false, mes: 'y' }]) === null && /if \(rephraseAsked\(\)\) \{\s*takeBack\(\);/.test(js) && /fillInput\(back\.text\)/.test(js), 'say it another way takes the line back');
}
// R21: typed guillemets are quotation marks, capitals are louder on a common word only, and a hyphen shared with a hyphened word
// after "and" or "or" is no cut-off.
{
  const plain = ['Er sagte: ›Komm sofort her!‹', 'Sie flüsterte: ‹Nicht jetzt›.', 'I ask the NATO officer about the ICU.', 'I wave at the pre- and post-war crowd.', 'Two- or three-year-olds play.'].filter(l => { const x = P.readProsody(l); return x.marked || x.plain !== l; });
  const loud = ['"STOP," I say.', '"NOOOO!" I scream.', "I yell, \"DON'T!\"", '"You IDIOTS," I mutter.'].filter(l => !P.readProsody(l).words.some(w => w.marks.includes('loud')));
  const cut = P.readProsody('"Sto- stop it," I say.').words.some(w => w.marks.includes('cut'));
  ok(!plain.length && !loud.length && cut, 'guillemets, capitals and hyphens read as written', `${plain.join(' | ')} || ${loud.join(' | ')} || cut ${cut}`);
}
// R49: abbreviations that are dictionary nouns stay as written (AIDS, SIM; PIN, SWAT and LED after a determiner or a
// possessive) and are louder as a verb ("PIN him down!"); a hyphen before a colon is a face (D-:), not a cut-off.
{
  const read = l => P.readProsody(l), still = ['The SWAT team arrives; I enter my PIN. D-:', 'She has AIDS.', 'An LED lamp glows.', 'My SIM card.'].filter(l => { const x = read(l); return x.marked || x.plain !== l; });
  const pin = read('PIN him down!');
  ok(!still.length && pin.plain === 'Pin him down!' && pin.words[0].marks.includes('loud'), 'abbreviations that are nouns; faces', `${still.join(' | ')} || ${pin.plain}`);
}
// R50: a line added to the world book is read in its words: the voice marks hidden in it do not reach the model or the entry.
{
  const js = fs.readFileSync(`${ROOT}/src/index.js`, 'utf8');
  const body = /async function addEntry\(text\) \{([\s\S]*?)\n\}/.exec(js)?.[1] ?? '';
  ok(/const line = visible\(text\);/.test(body) && !/\btext\b/.test(body.replace('visible(text)', '')), 'world-book line without hidden marks', body.slice(0, 120));
}
// R60: a cut-off before a closing quotation mark or bracket is a cut-off ("›War-‹", "(wai-)", "‘Sto-’", "«Sto-»").
{
  const missed = ['Er rief: ›War-‹', '(wai-)', 'He said ‘Sto-’', '«Sto-»', '"Sto-"', '[sto-]'].filter(t => !P.readProsody(t).words.some(w => w.marks.includes('cut')));
  ok(!missed.length && !P.readProsody('D-:').marked, 'cut-offs before closing marks', missed.join(' | '));
}
// R61: speech in guillemets is the speech whose loudness counts: «STOP!» I shout is loud speech, as "STOP!" I shout is.
{
  const eff = ['«STOP!» I shout.', '»STOP!« I shout.', '„STOP!“ I shout.', '"STOP!" I shout.'].map(t => P.effortOf(P.readProsody(t)));
  // A quote left open runs to the line's end; a word opening one starts a sentence (its capital kept).
  const open = P.effortOf(P.readProsody('"STOP!" I shout, "now')), plain = P.readProsody('I shout «STOP!»').plain;
  ok(eff.every(e => e === 'loud') && open === 'raised' && plain === 'I shout «Stop!»', 'speech in any quotes', `${eff.join()} ${open} ${plain}`);
}
// R62: the narrator's prompt carries no hidden tag character.
{
  const js = fs.readFileSync(`${ROOT}/src/index.js`, 'utf8');
  ok(/c\.setExtensionPrompt\(KEY, untagged\(parts\.filter\(Boolean\)\.join\('\\n\\n'\)\)/.test(js), 'narrator prompt without tag characters');
}
// P5: the note shows the voice as its first row, tagged Voice in speech's colour.
const vv = U.noteView({ acts: [], things: [], voice: 'louder: Stop · pitch up on think' }, true);
ok(vv?.rows[0]?.tag === 'Voice' && vv.rows[0].kind === 'speech' && vv.rows[0].text === 'louder: Stop · pitch up on think', 'voice row in the note', JSON.stringify(vv));

// What the words were read as (intent.ts) shows on the note's line, ahead of a guess.
const mv = U.noteView({ acts: [], things: [], meant: ['punhc → punch', 'him back → Tom back'] }, true);
ok(mv?.meant === 'punhc → punch; him back → Tom back', 'the line as meant on the note', JSON.stringify(mv));

// Ordinary writing stays words: a whole number in brackets ("Tom (35)", "the year (1850)") and a temperature ("20 °C").
{
  const plainOnes = ['John Smith (35) checks items (1) and (2).', 'The year (1850) was cold.', 'It is 20 °C outside.', 'Set the oven to 180 °C, Tom.', 'It is -5 °F.'];
  const read = plainOnes.filter(l => { const x = P.readProsody(l); return x.marked || x.plain !== l; });
  ok(!read.length && P.readProsody('Wait (0.5) what?').words[0]?.pause === 0.5 && P.readProsody('The °old° man.').words[1]?.marks.includes('quiet'), 'numbers in brackets and temperatures stay words', read.map(l => `${l} → ${P.deliveryOf(P.readProsody(l))}`).join(' | '));
}
// A mark on a word in guillemets or before a dash sits on its letters: «Stop-», the underline under Stop only.
{
  const r = VC.markWords('«Stop»', 1, 5, 'cut'), t = '«Stop»'.slice(0, r.from) + r.insert + '«Stop»'.slice(r.to), parts = U.mirrorParts(t);
  ok(VC.toNotation(t) === '«Stop-»' && parts[0]?.text === '«' && !parts[0]?.family && VC.typeset(t).map(x => x.text).join('') === '«Stop—»', 'marks on the letters inside guillemets', `${VC.toNotation(t)} ${JSON.stringify(parts.map(p => p.text))}`);
}
// A line that quotes, in any quotation marks, is no correction ("No, Will, ›run!‹" is said to Will).
ok(['No, Will, ›run!‹', 'No, Will «stop»', 'No, Will "stop"'].every(l => A.correctionOf(l) === null) && A.correctionOf('no, Will') === 'Will', 'a line that quotes is no correction', ['No, Will, ›run!‹', 'No, Will «stop»'].map(l => A.correctionOf(l)).join(' | '));
// Every request to a model leaves with hidden marks as notation, whoever built it (a summary's raw prompt reads the saved chat).
{
  const r = VC.markWords('I say stop now', 6, 10, 'loud'), t = 'I say stop now'.slice(0, r.from) + r.insert + 'I say stop now'.slice(r.to);
  const d = { messages: [{ role: 'user', content: `Narrator:\nHello.\n\nMara:\n${t}` }, { role: 'user', content: [{ type: 'text', text: t }] }], prompt: `Mara: ${t}` };
  VC.notateRequest?.(d);
  ok(!VC.hasHidden(JSON.stringify(d)) && d.messages[0].content.endsWith('I say STOP now') && d.messages[1].content[0].text === 'I say STOP now' && d.prompt === 'Mara: I say STOP now', 'a request leaves with notation', JSON.stringify(d));
}
// A name in a line shouted in capitals keeps its capital: "I SHOUT AT WILL TO RUN!" is said to Will.
ok(P.readProsody('I SHOUT AT WILL TO RUN!', ['Will', 'Mara']).plain === 'I shout at Will to run!' && P.readProsody('I SHOUT AT WILL TO RUN!').plain === 'I shout at will to run!', 'a shouted name keeps its capital', P.readProsody('I SHOUT AT WILL TO RUN!', ['Will']).plain);
// A feeling marks the line and keeps the player's selection, so the next mark goes on the words they chose.
{
  const t0 = 'I say stop now', r = VC.markWords(t0, 6, 10, 'feeling:anger'), t = t0.slice(0, r.from) + r.insert + t0.slice(r.to);
  ok(VC.visible(t.slice(r.selStart, r.selEnd)) === 'stop', 'a feeling keeps the selection', JSON.stringify(VC.visible(t.slice(r.selStart, r.selEnd))));
}
console.log(`ui: ${n - miss} of ${n}`); process.exitCode = miss ? 1 : 0; // exitCode lets output queued for a pipe finish (process.exit() can cut it)
