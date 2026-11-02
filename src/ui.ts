// What the player sees of the engine's reading and questions, drawn in the player's own SillyTavern theme (style.css). Kept
// free of SillyTavern so tests run it with a stand-in document.
//
// The reading of a line sits under that line in the chat, where it stays: a note about one message belongs next to it
// (Nielsen Norman Group, "Indicators, Validations, and Notifications"), and a message that vanishes after a few seconds with
// no other place to read it is a time limit (WCAG 2.2 SC 2.2.1, Understanding document). Interactive fiction prints its
// reading the same way: Inform writes "(the green box)" into the transcript when its parser chose for the player.
//
// The player's picks (2026-10-23): the most information in the fewest words, an aside in a book serif and italics, one
// colour per kind of rule, folded until opened, questions as prose with linked choices, type that follows the story's era.
// So each call is one line: a tag naming the kind of rule (Sight, Speech, Body…) in that kind's colour, then the call in
// the fewest words that decide it, the player's character (who makes every call shown) left out; folded, the note is one
// line holding the guess, if any, and the tagged calls. Colour is never the only carrier: each tag is also a word. The
// hues are Okabe & Ito's palette for colour-blind readers (Color Universal Design, 2008), mixed with the theme's own text
// colour so each stays legible on that theme (tests/ui.test.mjs checks 4.5:1, WCAG 1.4.3, on SillyTavern's shipped themes
// and a light one).
//
// A reading taken unasked ends in "or…", and opened offers the others as linked words ("Or did you mean to catch up with
// Tom?"); each link fills the input box with the player's correction ("no, catch up with Tom"), so a wrong guess is undone
// by the next line rather than warned about before (Raskin, "Never Use a Warning When You Mean Undo"). A question is a
// sentence with its choices linked, nothing focused or highlighted in advance: a choice shown pre-chosen is picked more often
// (the default effect; Johnson & Goldstein 2003, Science 302:1338).
import { correctionLine } from './rules/ask.js';
import { kindOf, type Kind } from './rules/reading.js';
import { tokens, typeset, CODE, WORD_PARTS } from './rules/voice-code.js';
import type { Mark } from './rules/prosody.js';

export interface Taken { label: string; others: string[] }
export interface Act { text: string; detail: string; kind?: Kind; brief?: string }
/** The note on one player's line; `line` is the text it read, so a line edited since shows no note. */
export interface ReadingNote { redone?: string | null; taken?: Taken | null; meant?: string[]; acts: Act[]; things: string[]; line?: string; voice?: string | null }

/** The story's era, for the type: bands by the type a book of that time was set in (era classes in style.css). */
export type Era = 'c16' | 'c17' | 'c18' | 'c19' | 'c20' | 'now';
export function eraOf(year: number | null): Era {
    if (year == null) return 'now';
    return year < 1600 ? 'c16' : year < 1750 ? 'c17' : year < 1800 ? 'c18' : year < 1920 ? 'c19' : year < 1970 ? 'c20' : 'now';
}
/** The mark pointing at a guessed reading: the manicule of manuscripts and print up to the early twentieth century, an arrow
 * after. */
export const markOf = (era: Era) => era === 'c20' || era === 'now' ? '→' : '☞';
/** Whether the theme's text is light (a dark theme) or dark, from its colour (rgb() or rgba()); each kind's colour is mixed
 * with the text colour in a share set for that tone (style.css). */
export function toneOf(textColour: string): 'dark' | 'light' {
    const [r = 220, g = 220, b = 210] = (textColour.match(/[\d.]+/g) ?? []).map(Number);
    const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4 ? 'dark' : 'light';
}

export const TAG: Record<Kind, string> = { sight: 'Sight', sound: 'Sound', speech: 'Speech', body: 'Body', move: 'Move', mind: 'Mind', time: 'Time', thing: 'Thing' };
/** One colour per family of kinds: sight and sound share the senses' colour, their words tell them apart. */
export const FAMILY: Record<Kind, string> = { sight: 'sense', sound: 'sense', speech: 'speech', body: 'body', move: 'move', mind: 'mind', time: 'time', thing: 'thing' };

/** Choices said as one sentence: the words every choice opens with said once ("hit Tom or Will"), the rest linked. */
export function shared(labels: string[]): { lead: string; items: string[] } {
    const words = labels.map(l => `${l.charAt(0).toLowerCase()}${l.slice(1)}`.split(' '));
    let k = 0;
    while (words.every(w => w.length > k + 1 && w[k] === words[0]![k])) k++;
    return { lead: words[0]!.slice(0, k).join(' '), items: words.map(w => w.slice(k).join(' ')) };
}
const or = (n: number, i: number) => i === 0 ? '' : i === n - 1 ? (n > 2 ? ', or ' : ' or ') : ', ';

export type Row = { kind: Kind; tag: string; text: string; detail?: string };
/** What the note shows: the correction it redid, the guess (with the others while the line is the player's latest), one row
 * per call, the things read. Null when the line was read as nothing. */
export interface NoteView { redone?: string; taken?: string; meant?: string; alts?: { lead: string; items: string[]; lines: string[] }; rows: Row[] }
export function noteView(n: ReadingNote, latest: boolean): NoteView | null {
    const lower = (t: string) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    const rows: Row[] = [
        // How the line was said, read from the player's marks (prosody.ts deliveryOf).
        ...n.voice ? [{ kind: 'speech' as const, tag: 'Voice', text: n.voice }] : [],
        ...n.acts.map(a => { const kind = a.kind ?? kindOf(a.detail.split(':')[0] ?? ''); return { kind, tag: TAG[kind], text: a.brief ?? a.text, detail: a.detail }; }),
        ...n.things.map(t => ({ kind: 'thing' as const, tag: TAG.thing, text: t })),
    ];
    const others = latest && n.taken?.others.length ? n.taken.others : null;
    const view: NoteView = {
        ...n.redone ? { redone: n.redone.replace(/^The player corrects their last line: /, '').replace(/\.$/, '') } : {},
        ...n.taken ? { taken: lower(n.taken.label) } : {},
        // What the words were read as (intent.ts): "punhc → punch", "him back → Tom back", "again → I punch Tom".
        ...n.meant?.length ? { meant: n.meant.join('; ') } : {},
        ...others ? { alts: { ...shared(others), lines: others.map(correctionLine) } } : {},
        rows,
    };
    return view.redone || view.taken || view.meant || rows.length ? view : null;
}

/** Where the note is kept: on the player's message, extra.rulesReading (saved with the chat, as extra.rulesNarration). */
export const NOTE_KEY = 'rulesReading';
type Msg = { is_user?: boolean; mes?: string; extra?: Record<string, unknown> } | undefined;
/** "Say it another way": the player's line the reply was for, to take out of the chat and put back in the input box with its
 * marks, so the next line replaces it; null when the chat no longer ends with it. */
export function lineToTakeBack(chat: Msg[]): { index: number; text: string } | null {
    const i = chat.length - 1, m = chat[i];
    return m?.is_user && typeof m.mes === 'string' ? { index: i, text: m.mes } : null;
}
/** The notes to draw: each player's message that holds one for its present words; the others offered on the player's latest
 * line only, the one a correction in the next line can redo (question-pass.ts). */
export function notesOf(chat: Msg[]): { index: number; view: NoteView }[] {
    let latest = -1;
    chat.forEach((m, i) => { if (m?.is_user) latest = i; });
    return chat.flatMap((m, i) => {
        const held = m?.is_user ? m.extra?.[NOTE_KEY] as ReadingNote | undefined : undefined;
        const note = held && (held.line == null || held.line === m?.mes) ? held : undefined;
        const view = note ? noteView(note, i === latest) : null;
        return view ? [{ index: i, view }] : [];
    });
}

/** The parts of a document the note uses (a browser's, or a test's stand-in). */
export interface Doc { createElement(tag: string): El; createTextNode(t: string): El }
export interface El {
    className: string; textContent: string | null; title: string; type?: string;
    appendChild(c: El): El; setAttribute(k: string, v: string): void; addEventListener(e: string, f: () => void): void;
}
export interface Look { era: Era; tone: 'dark' | 'light' }
/** The note as an element: a <details> folded to one line (the guess and the tagged calls), opened to a line per call and the
 * other readings as linked words, each handing its correction to `fill`. Every text is set as text. */
export function drawNote(doc: Doc, v: NoteView, look: Look, fill: (text: string) => void): El {
    const el = (tag: string, cls: string, text?: string) => { const e = doc.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
    const tag = (r: Row) => el('span', `rules-tag rules-k-${FAMILY[r.kind]}`, r.tag);
    const box = el('details', `rules-reading rules-era-${look.era}`);
    box.setAttribute('data-tone', look.tone);
    const sum = el('summary', 'rules-reading-sum');
    sum.setAttribute('aria-label', 'How the rule engine read this line');
    if (v.redone) sum.appendChild(el('span', 'rules-reading-redone', `Redone: ${v.redone}`));
    if (v.meant) sum.appendChild(el('span', 'rules-reading-meant', `${markOf(look.era)} ${v.meant}`));
    if (v.taken) sum.appendChild(el('span', 'rules-reading-taken', `${markOf(look.era)} ${v.taken}`));
    // "or…" stays whole when the guess is cut short on a narrow screen: it says other readings are offered.
    if (v.taken && v.alts) sum.appendChild(el('span', 'rules-reading-or', '— or…'));
    const list = el('span', 'rules-reading-list');
    for (const r of v.rows) { const item = el('span', 'rules-reading-item'); item.appendChild(tag(r)); item.appendChild(doc.createTextNode(` ${r.text}`)); list.appendChild(item); }
    sum.appendChild(list);
    sum.appendChild(el('span', 'rules-reading-label', 'read as'));
    box.appendChild(sum);
    const body = el('div', 'rules-reading-body');
    for (const r of v.rows) {
        const row = el('div', 'rules-reading-row');
        row.appendChild(tag(r));
        const text = el('span', 'rules-reading-text', r.text);
        if (r.detail) text.title = r.detail;
        row.appendChild(text);
        body.appendChild(row);
    }
    if (v.alts) {
        const p = el('p', 'rules-reading-alts');
        p.appendChild(doc.createTextNode(`Or did you mean to ${v.alts.lead ? `${v.alts.lead} ` : ''}`));
        v.alts.items.forEach((t, i) => {
            if (i) p.appendChild(doc.createTextNode(or(v.alts!.items.length, i)));
            const b = el('button', 'rules-link', t);
            b.type = 'button';
            b.title = `Puts "${v.alts!.lines[i]}" in your message box`;
            b.addEventListener('click', () => fill(v.alts!.lines[i]!));
            p.appendChild(b);
        });
        p.appendChild(doc.createTextNode('?'));
        body.appendChild(p);
    }
    box.appendChild(body);
    return box;
}

const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
/** The answer "say it another way" returns; choices return OPTION + their index. */
export const OTHER = 9, OPTION = 10;
type Popup = { dlg?: { addEventListener(e: string, f: (ev: { key: string; preventDefault(): void }) => void): void; querySelectorAll(s: string): ArrayLike<{ addEventListener(e: string, f: () => void): void; getAttribute(k: string): string | null }> }; complete(r: number): unknown };
/** A question's popup: the player's words, then one sentence with every choice a link in the same form (numbered, picked by
 * its number key or a click), "say it another way" last; the sentence holds the focus, so Enter picks nothing. `notes`
 * (the things' descriptions) follow each choice. Arguments for callGenericPopup(content, POPUP_TYPE.TEXT, '', options). */
export function askPopup(q: { said: string; choices: string[]; notes?: string[]; things?: boolean }, o: { era?: Era; reduced?: boolean } = {}): { content: string; options: Record<string, unknown> } {
    const s = q.things ? { lead: '', items: q.choices } : shared(q.choices);
    const links = s.items.map((t, i) => `${or(s.items.length, i)}<button type="button" class="rules-link rules-ask-choice" data-choice="${i}"><sup>${i + 1}</sup>${esc(t)}</button>${q.notes?.[i] ? ` <span class="rules-ask-note">(${esc(q.notes[i]!)})</span>` : ''}`).join('');
    const sentence = q.things ? `Do you mean ${links}?` : `Do you mean to ${s.lead ? `${esc(s.lead)} ` : ''}${links}?`;
    return {
        content: `<div class="rules-ask rules-era-${o.era ?? 'now'}"><p class="rules-ask-said">“${esc(q.said)}”</p><p class="rules-ask-prose" tabindex="-1" autofocus>${sentence}</p>`
            + `<p class="rules-ask-foot"><button type="button" class="rules-link rules-ask-choice" data-choice="other">Say it another way</button></p></div>`,
        options: {
            okButton: false, cancelButton: false, allowVerticalScrolling: true, animation: o.reduced ? 'none' : 'fast',
            onOpen: (p: Popup) => {
                const all = p.dlg?.querySelectorAll('.rules-ask-choice');
                for (let i = 0; i < (all?.length ?? 0); i++) {
                    const b = all![i]!, c = b.getAttribute('data-choice');
                    b.addEventListener('click', () => { void p.complete(c === 'other' ? OTHER : OPTION + Number(c)); });
                }
                // Number keys pick (1 for the first choice), as in Disco Elysium's and 80 Days' choice lists.
                p.dlg?.addEventListener('keydown', ev => {
                    const n = Number(ev.key);
                    if (Number.isInteger(n) && n >= 1 && n <= q.choices.length) { ev.preventDefault(); void p.complete(OPTION + n - 1); }
                });
            },
        },
    };
}
/** The choice a popup's result picked, or null (said another way, closed, or escaped). */
export function askAnswer(result: unknown, n: number): number | null {
    return typeof result === 'number' && result >= OPTION && result < OPTION + n ? result - OPTION : null;
}
/** The player's words a question quotes ('"Follow the thief": which do you mean?' → Follow the thief). */
export const saidOf = (question: string) => /^"([^"]+)"/.exec(question)?.[1] ?? question;

// The voice toolbar: plain words, each written in the effect it names ("louder" in small capitals, "rises" lifted), in
// groups, each group with one soft colour that also underlines its marked words in the message box. Picking one marks the
// selected words with hidden codes (src/rules/voice-code.ts): the player sees their own words, never a sign.
export type Family = 'sense' | 'body' | 'move' | 'mind' | 'time' | 'speech';
export interface VoiceItem { id: string; label: string; mark?: Mark }
export const VOICE_GROUPS: { group: string; family: Family; items: VoiceItem[] }[] = [
    { group: 'Pitch', family: 'sense', items: [{ id: 'up', label: 'rises', mark: 'up' }, { id: 'down', label: 'falls', mark: 'down' }] },
    { group: 'Volume', family: 'body', items: [{ id: 'loud', label: 'louder', mark: 'loud' }, { id: 'quiet', label: 'softer', mark: 'quiet' }, { id: 'whisper', label: 'whispered', mark: 'whisper' }] },
    { group: 'Pace', family: 'move', items: [{ id: 'fast', label: 'faster', mark: 'fast' }, { id: 'slow', label: 'slower', mark: 'slow' }, { id: 'stretch', label: 'drawn out', mark: 'stretch' },
        { id: 'micro', label: 'short pause' }, { id: 'pause', label: 'pause' }, { id: 'cut', label: 'cut off', mark: 'cut' }] },
    { group: 'Voice', family: 'mind', items: [{ id: 'breathy', label: 'breathy', mark: 'breathy' }, { id: 'creaky', label: 'creaky', mark: 'creaky' }, { id: 'falsetto', label: 'falsetto', mark: 'falsetto' },
        { id: 'smile', label: 'smiling', mark: 'smile' }, { id: 'laugh', label: 'laughing', mark: 'laugh' }] },
    { group: 'Breath', family: 'time', items: [{ id: 'inbreath', label: 'breath in', mark: 'inbreath' }, { id: 'outbreath', label: 'breath out', mark: 'outbreath' }] },
    { group: 'Weight', family: 'speech', items: [{ id: 'stress', label: 'stressed', mark: 'stress' }] },
    { group: 'Feeling', family: 'speech', items: [{ id: 'feeling:anger', label: 'angry' }, { id: 'feeling:fear', label: 'afraid' }, { id: 'feeling:happiness', label: 'happy' },
        { id: 'feeling:sadness', label: 'sad' }, { id: 'feeling:tenderness', label: 'tender' }] },
];
/** Each mark's plain name and the colour family of its group. */
export const MARK_NAME: Record<string, string> = Object.fromEntries(VOICE_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label])));
const FAMILY_OF: Record<string, Family> = Object.fromEntries(VOICE_GROUPS.flatMap(g => g.items.map(i => [i.id, g.family])));
/** The family a word's codes take their soft colour from (the first mark's), and the marks named for its hover text. */
export function voiceLook(codes: string[]): { family: Family; title: string } | null {
    const ids = codes.map(c => c.startsWith('f:') ? `feeling:${c.slice(2)}` : c === 'p.' ? 'micro' : c.startsWith('p') ? 'pause' : (Object.entries(CODE).find(([, v]) => v === c)?.[0] ?? '')).filter(Boolean);
    if (!ids.length) return null;
    return { family: FAMILY_OF[ids[0]!] ?? 'speech', title: ids.map(i => MARK_NAME[i] ?? i).join(', ') };
}
/** The message box's layer: the box's text exactly (hidden codes included, so every letter falls where the box has it), each
 * marked word in a span coloured by its family. */
export function mirrorParts(text: string): { text: string; family?: Family; title?: string }[] {
    const out: { text: string; family?: Family; title?: string }[] = [];
    let cursor = 0;
    for (const k of tokens(text)) {
        const look = voiceLook(k.codes);
        if (!look) continue;
        if (k.start > cursor) out.push({ text: text.slice(cursor, k.start) });
        // The colour under the word's letters: its quotation marks and punctuation stay plain.
        const m = WORD_PARTS.exec(k.text)!;
        if (m[1]) out.push({ text: m[1] });
        out.push({ text: m[2] ?? '', family: look.family, title: look.title });
        if (m[3]) out.push({ text: m[3] });
        cursor = k.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) });
    // A last line break needs a character after it to take its height in the layer.
    if (text.endsWith('\n')) out.push({ text: '\u200b' });
    return out;
}
/** The chat's typesetting of a run of text with hidden marks (voice-code.ts typeset) as elements: each marked word a span with
 * a class per mark and its marks named on hover, the small added words (a pause's dot, "inhales", the feeling) muted. */
export function drawVoice(doc: Doc, text: string): El[] {
    return typeset(text).map(seg => {
        if (seg.add) { const e = doc.createElement('span'); e.className = `rules-v-add rules-v-add-${seg.add}`; e.textContent = seg.text; if (seg.add === 'micro' || seg.add === 'pause') e.title = seg.add === 'micro' ? 'short pause' : seg.seconds === 0.5 ? 'pause, half a second' : `pause, ${seg.seconds} s`; return e; }
        if (seg.marks?.length) { const e = doc.createElement('span'); e.className = ['rules-v', ...seg.marks.map(m => `rules-v-${m}`)].join(' '); e.textContent = seg.text; e.title = seg.marks.map(m => MARK_NAME[m] ?? m).join(', '); return e; }
        return doc.createTextNode(seg.text);
    });
}
