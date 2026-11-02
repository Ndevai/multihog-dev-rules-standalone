// Rules Engine for SillyTavern: code decides outcomes, the narrator writes them (docs/df-body-engine.md). Each turn a
// question pass names the outcomes in doubt and the engine decides them; the narrator gets the brief, the story time,
// [BODY], [KNOWS] and [DECIDED] as one system message; a rule check reads the reply and redoes it once when it bends a result.
import { pulseSelfTest } from './rules/pulse.js';
import { registerRulesTools, onRulesGenerationStarted, onRulesMessageReceived, onRulesSwiped, syncRulesToChat, rulesBrief, RULES_BRIEF_DECIDED, knowledgeInjection, possessionsInjection, scenePosition, questionPassRan, storyTime, setStoryTime, REGISTRY, historyCheck, sceneSky, storyYearNow, } from './rules/rules-tools.js';
import { runQuestionPass, decidedInjection, decidedResults, turnLog, setGuided, setOpen, GUIDED, actionItems, rephraseAsked, takenReading, redoneBy, voiceRead, meantReading } from './rules/question-pass.js';
import { noteView, notesOf, lineToTakeBack, drawNote, askPopup, askAnswer, saidOf, eraOf, toneOf, VOICE_GROUPS, mirrorParts, drawVoice, NOTE_KEY } from './ui.js';
import { markWords, keyDelete, hasHidden, notateChat, visible, untagged, notateRequest } from './rules/voice-code.js';
import { NARRATION_RULE, narrationSchema, readNarration, proseOf } from './rules/narration.js';
import { onRulesAuditMessage, takeAuditNote, registerRulesStatsCommand } from './rules/rules-audit.js';
import { registerRulesEvalCommand } from './rules/eval.js';
import { bodyBlock, trackedPeople } from './rules/body-sheet.js';
import { parseStoryTime, formatStoryTime } from './rules/clock.js';
import { sendModel } from './send.js';
import { worldBlock, applyWorld, checkEntry, parseEntry, FILL_SYSTEM } from './rules/world.js';
import { removeWithDescendants, outcomeLine, bornIn } from './rules/counterfactual.js';
import { firstYear, earlier, loadChat } from './rules/history.js';
import { loadPopulation } from './rules/population.js';
import { seededRng } from './rules/body-engine.js';
import { loadColex } from './rules/colex.js';
import { loadLanguageYears } from './rules/languages.js';
import { loadThings } from './rules/things.js';
const NAME = 'rules-engine', KEY = 'rules_engine';
// SillyTavern extension_prompt_types.IN_CHAT and extension_prompt_roles.SYSTEM (public/script.js).
const IN_CHAT = 1, SYSTEM = 0;
// The engine's message sits this many messages above the end of the chat: 1 = just above the player's last message.
const DEPTH = 1;
const DEFAULTS = { enabled: true, questionPass: true, ruleCheck: true, structured: true, suggest: false, profile: '', maxTokens: 0, effort: 'low' };
const ctx = () => SillyTavern.getContext();
const toastr = globalThis.toastr;
function settings() {
    const all = ctx().extensionSettings;
    all[NAME] = { ...DEFAULTS, ...(all[NAME] || {}) };
    return all[NAME];
}
// A connection that refuses the plan's schema (a 400, an unknown field) is asked again without it, and the plan goes back to
// being read from free text for the rest of the session.
const send = async (system, user, o = {}) => {
    const s = settings(), base = { profile: s.profile, maxTokens: s.maxTokens, effort: s.effort ?? 'low' };
    if (!o.schema)
        return sendModel(system, user, base);
    try {
        return await sendModel(system, user, { ...base, schema: o.schema });
    }
    catch (e) {
        // Only a refusal of the schema itself turns it off; a rate limit or a dropped connection is that turn's failure alone
        // (a 429 had turned structured output off for the rest of the session).
        if (!/schema|response_format|guided/i.test(String(e?.message ?? e)))
            throw e;
        console.warn('[Rules engine] schema refused; plans read from text from now on:', e);
        setGuided(false);
        return sendModel(system, user, base);
    }
};
// Card text shown to the question model, characters per field [ASSUMED]: enough for species, build and training.
const CARD_CHARS = 1500;
/** The player's persona, the character card and the scenario: where species, build and training are written. */
function groupMembers() {
    const c = ctx();
    const g = c.groupId ? c.groups?.find(x => x.id === c.groupId) : null;
    return g ? g.members.map(a => c.characters.find(ch => ch.avatar === a)).filter((x) => !!x) : [];
}
function castBlock() {
    const c = ctx();
    const raw = c.getCharacterCardFields?.() ?? {};
    const field = (k) => { const v = raw[k]; return String((typeof v === 'function' ? v() : v) ?? '').trim().slice(0, CARD_CHARS); };
    const lines = [
        field('persona') && `${c.name1 || 'Player'} (the player's character): ${field('persona')}`,
        field('description') && `${c.name2 || 'Character'}: ${field('description')}`,
        // A group chat's other members, each with their own card (drawn as strangers they took a random age and sex).
        ...groupMembers().filter(m => m.name !== c.name2).map(m => `${m.name}: ${String(m.description ?? m.data?.description ?? '').trim().slice(0, CARD_CHARS) || 'a character of this story'}`),
        field('scenario') && `Scenario: ${field('scenario')}`,
    ].filter(Boolean);
    return lines.length ? `[CAST]\n${lines.join('\n')}\n[/CAST]` : '';
}
// The world book belongs to the character card, so every chat with that card shares it; a group chat keeps its own.
const cardOf = () => { const c = ctx(); return !c.groupId && c.characterId !== undefined ? c.characters[Number(c.characterId)] : null; };
function getBook() {
    const card = cardOf();
    return (card ? card.data?.extensions?.rulesWorld : ctx().chatMetadata?.rulesWorld) ?? [];
}
async function saveBook(book) {
    const c = ctx(), card = cardOf();
    if (card)
        await c.writeExtensionField(Number(c.characterId), 'rulesWorld', book);
    else {
        c.chatMetadata.rulesWorld = book;
        await c.saveMetadata();
    }
    applyWorld(book);
    renderBook();
}
/** Drafts an entry from one line, shows it for editing, and saves what the user approves. The line is read in its words: the
 *  voice marks hidden in it (voice-code.ts) say how a line is spoken, which an entry of the world does not hold. */
async function addEntry(text) {
    const line = visible(text);
    let draft = null;
    try {
        draft = parseEntry(await send(FILL_SYSTEM, `Line: ${line}\nStory setting: ${[storyState(), castBlock()].filter(Boolean).join('\n') || 'not given'}`));
    }
    catch (e) {
        console.warn('[Rules engine] world fill failed:', e);
    }
    return approveEntry(draft ?? { what: line });
}
/** A person gone from history from `year` on: code draws, once, what becomes of each of their inventions; the user approves. */
async function removePersonEntry(arg) {
    // A year sets when the person is gone; without one, they never lived (from their birth year, when Wikidata has it).
    const m = arg.match(/^(.+?)(?:[,;]\s*(-?\d{1,4}))?\s*$/);
    if (!m || !m[1].trim())
        return 'Give a name, and a year when they are gone: /world-without Karl Benz, 1880 (no year: they never lived).';
    const name = m[1].trim(), year = m[2] != null ? Number(m[2]) : bornIn(name);
    if (year == null)
        return `No birth year for "${name}"; give the year: /world-without ${name}, 1880.`;
    const salt = ctx().chatMetadata?.rulesEngine?.salt ?? '';
    const { people, outcomes } = removeWithDescendants(name, year, seededRng(`${salt}:without:${name.toLowerCase()}:${year}`));
    if (!outcomes.length && !people.length)
        return `No invention or discovery by "${name}" from ${year} on in the lists (Wikipedia's timeline of inventions and a Wikidata export: about 2,400 with a named inventor).`;
    return approveEntry({ what: `${name} gone from ${year}`, kind: 'event', since: year, worldwide: true,
        cause: m[2] != null ? `${name} died before ${year}.` : `${name} never lived.`, reaches: ['daily life'], reflections: [...people, ...outcomes.map(outcomeLine)].slice(0, 15),
        changes: outcomes.map(changeOf) });
}
const changeOf = (o) => o.result === 'never made' ? { what: o.what, year: o.year, never: true } : { what: o.what, year: o.year, new_year: o.newYear ?? o.year };
const saltOf = () => ctx().chatMetadata?.rulesEngine?.salt ?? '';
/** An event that removes named people from a year: /world-event The plague of 1665 reaches Cambridge; Isaac Newton; 1665 */
async function eventEntry(arg) {
    const [cause, names, y] = arg.split(';').map(x => x.trim());
    const year = Number(y);
    if (!cause || !names || !Number.isFinite(year))
        return 'Give the event, the people it removes and the year: /world-event The plague reaches Cambridge; Isaac Newton; 1665';
    const all = names.split(',').map(n => n.trim()).filter(Boolean).map(n => removeWithDescendants(n, year, seededRng(`${saltOf()}:event:${n.toLowerCase()}:${year}`)));
    const people = all.flatMap(r => r.people), outcomes = all.flatMap(r => r.outcomes);
    return approveEntry({ what: cause, kind: 'event', since: year, worldwide: true, cause, reaches: ['daily life'],
        reflections: [...people, ...outcomes.map(outcomeLine)].slice(0, 15).concat(people.length || outcomes.length ? [] : [cause]), changes: outcomes.map(changeOf) });
}
/** An invention made earlier than in real history: /world-earlier telephone, 1850 */
async function earlierEntry(arg) {
    const m = arg.match(/^(.+?)[,;]\s*(-?\d{1,4})\s*$/);
    if (!m)
        return 'Give the invention and the year: /world-earlier telephone, 1850';
    const f = firstYear(m[1].trim());
    if (!f)
        return `No dated invention matches "${m[1].trim()}".`;
    const r = earlier(f.year, Number(m[2]), seededRng(`${saltOf()}:earlier:${f.label.toLowerCase()}:${m[2]}`));
    toastr.info(`${f.label}: real ${f.year}; a lead of ${f.year - Number(m[2])} years is matched by ${Math.round(r.share * 100)} % of first discoverers; drawn: ${r.year}.`, 'World book');
    return approveEntry({ what: `${f.label} made early`, kind: 'technology', since: r.year, worldwide: true, cause: `An inventor ahead of the field made ${f.label} in ${r.year}.`,
        reaches: ['daily life'], reflections: [`${f.label[0].toUpperCase()}${f.label.slice(1)} exists from ${r.year}.`], changes: [{ what: f.label, year: f.year, new_year: r.year }] });
}
/** Shows an entry for editing until it passes the check or is cancelled; saves it. */
async function approveEntry(draft) {
    const c = ctx();
    let text = JSON.stringify(draft, null, 1);
    for (;;) {
        const edited = await c.callGenericPopup('<h3>World book entry</h3><small>Edit and press OK to save; Cancel discards it.</small>', c.POPUP_TYPE.INPUT, text, { wide: true, large: true, rows: 18 });
        if (typeof edited !== 'string' || !edited.trim())
            return 'World book: nothing saved.';
        let raw;
        try {
            raw = JSON.parse(edited);
        }
        catch {
            toastr.warning('Not valid JSON; fix it and press OK.', 'World book');
            text = edited;
            continue;
        }
        const { entry, errors } = checkEntry(raw);
        if (!entry) {
            toastr.warning(errors.join('; '), 'World book');
            text = edited;
            continue;
        }
        await saveBook([...getBook(), entry]);
        return `World book: saved "${entry.what}".`;
    }
}
function renderBook() {
    const list = document.getElementById('rules_engine_world_list');
    if (!list)
        return;
    const book = getBook();
    list.innerHTML = '';
    if (!book.length) {
        list.textContent = 'No entries: the world is real history.';
        return;
    }
    book.forEach((e, i) => {
        const row = document.createElement('div');
        row.className = 'flex-container alignItemsCenter';
        const label = document.createElement('span');
        label.className = 'flex1';
        label.textContent = `${e.what} (${e.kind}, ${e.since ?? 'always'}, ${e.worldwide ? 'everywhere' : `${e.lat}, ${e.lon}, ${e.radius_km ?? 300} km`})`;
        const del = document.createElement('div');
        del.className = 'menu_button fa-solid fa-trash-can';
        del.title = 'Remove';
        del.addEventListener('click', () => { void saveBook(getBook().filter((_, j) => j !== i)); });
        row.append(label, del);
        list.append(row);
    });
}
function registerWorldCommands() {
    const c = ctx();
    if (!c.SlashCommand || !c.SlashCommandParser)
        return;
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'world-add', helpString: 'Add to this card\'s world book: /world-add orcs in London since the 900s. The model drafts the entry; you edit and approve it.',
        callback: async (_a, v) => String(v ?? '').trim() ? addEntry(String(v).trim()) : 'Give a line: /world-add orcs in London since the 900s.',
    }));
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'world-without', helpString: 'A person gone from history from a year on: /world-without Karl Benz, 1880. Each of their inventions after that year is made by another inventor, made later, or never made (drawn once, from the rates of independent invention); you edit and approve the entry.',
        callback: async (_a, v) => removePersonEntry(String(v ?? '')),
    }));
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'world-event', helpString: 'An event that removes people from a year: /world-event The plague reaches Cambridge; Isaac Newton, Isaac Barrow; 1665. Their children not yet born and their inventions follow as for /world-without.',
        callback: async (_a, v) => eventEntry(String(v ?? '')),
    }));
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'world-earlier', helpString: 'An invention made earlier than in real history: /world-earlier telephone, 1850. The lead is drawn against how far ahead real first inventors were.',
        callback: async (_a, v) => earlierEntry(String(v ?? '')),
    }));
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'world-list', helpString: 'Show this card\'s world book.',
        callback: async () => worldBlock(getBook(), scenePosition()) || 'The world book is empty: the world is real history.',
    }));
}
/** What the question model and the narrator read about the story now: time and bodies. */
function storyState() {
    const t = storyTime();
    const here = scenePosition();
    // Sun above the horizon at the scene, for the world book's day and night creatures (a calendar date is needed: a bare
    // "Day N" count has no season).
    const sky = t !== null && here ? sceneSky(t) : null, sunUp = sky ? sky.sunAlt >= 0 : null;
    return [worldBlock(getBook(), here, sunUp), t === null ? '' : `[TIME]\n${formatStoryTime(t)}\n[/TIME]`, bodyBlock(trackedPeople()), possessionsInjection()].filter(Boolean).join('\n');
}
globalThis.rulesEngineInterceptor = async (chat, _size, abort, type) => {
    const s = settings(), c = ctx();
    c.setExtensionPrompt(KEY, '', IN_CHAT, DEPTH);
    if (!s.enabled)
        return;
    // The player's hidden voice marks become the notation the model reads (voice-code.ts); the engine reads their codes, and
    // the chat as saved keeps them hidden (SillyTavern hands interceptors copies of its messages).
    notateChat(chat);
    if (!c.chatMetadata || ['quiet', 'impersonate'].includes(type))
        return;
    // The chat this turn belongs to: opening another chat while the pass waits on the model or the player ends the turn.
    const meta = c.chatMetadata, moved = () => ctx().chatMetadata !== meta;
    if (s.questionPass && type !== 'continue') {
        try {
            const read = await runQuestionPass(chat, send, [storyState(), castBlock()].filter(Boolean).join('\n'), choose, ask);
            if (moved()) {
                if (typeof abort === 'function')
                    abort(true);
                return;
            }
            // The player closed a question to say it another way: the reply waits for their next line (a toast confirms what
            // they just did).
            if (rephraseAsked()) {
                takeBack();
                toastr.info('Your line is back in the box: say it another way.', 'Your line');
                if (typeof abort === 'function')
                    abort(true);
                return;
            }
            // What the engine took from the player's line goes under that line and stays (src/ui.ts): a correction it redid,
            // a reading taken unasked with its change, one line per call for their character (reading.ts), the things read.
            keepNote({ redone: redoneBy(), taken: takenReading(), meant: meantReading(), voice: voiceRead(), acts: actionItems(), things: read.map(r => `${r.phrase} → ${r.label}${r.year != null ? ` (${r.year})` : ''}`) });
        }
        catch (e) {
            console.warn('[Rules engine] question pass skipped:', e);
        }
        if (moved()) {
            if (typeof abort === 'function')
                abort(true);
            return;
        }
    }
    // Suggestions: for a world that departs far from real history, the engine's outcomes are offered, and the story and the
    // world book decide; the rule check then redoes nothing and the reply is free prose.
    const suggest = settings().suggest;
    const decided = suggest ? decidedInjection().replace(/Narrate them as given; they stand\./, SUGGEST_LINE) : decidedInjection();
    const parts = [!questionPassRan() ? rulesBrief() : suggest ? SUGGEST_BRIEF : RULES_BRIEF_DECIDED, storyState(), knowledgeInjection(), decided, takeAuditNote() ?? '', structuredNow() ? NARRATION_RULE : ''];
    // The narrator's prompt carries no hidden tag character (voice-code.ts untagged).
    c.setExtensionPrompt(KEY, untagged(parts.filter(Boolean).join('\n\n')), IN_CHAT, DEPTH, false, SYSTEM);
};
// A question's popup (src/ui.ts askPopup): one sentence with every choice linked alike, numbered, nothing chosen or focused in
// advance, in the story's period type; "Say it another way", closing it or Escape means "none of these".
const reducedMotion = () => { try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
catch {
    return false;
} };
async function pick(q) {
    const c = ctx(), p = askPopup(q, { era: eraOf(storyYearNow()), reduced: reducedMotion() });
    return askAnswer(await c.callGenericPopup(p.content, c.POPUP_TYPE.TEXT, '', p.options), q.choices.length);
}
// Two things fit the player's word equally: the player says which (a guess would change what the scene can hold).
const choose = async (phrase, [a, b]) => {
    const say = (o) => `${o.label}${o.year != null ? ` (${o.year})` : ''}`, short = (t) => t.length > 70 ? `${t.slice(0, 69).trimEnd()}…` : t;
    const i = await pick({ said: phrase, choices: [say(a), say(b)], notes: [short(a.description), short(b.description)], things: true });
    return i === 0 ? a.id : i === 1 ? b.id : null;
};
// A choice the player's line leaves open (ask.ts): the player picks one of its readings.
const ask = async (question, options) => {
    const i = await pick({ said: saidOf(question), choices: options });
    return i == null ? null : options[i];
};
// The reading note (src/ui.ts) is kept on the player's message (extra.rulesReading) and drawn under it whenever the chat is
// drawn; "change" is offered on the player's latest line only, the one a correction can redo.
// The line the player chose to say another way leaves the chat and returns to the input box, marks and all, once the
// generation it started has stopped: the next line stands in its place, so the narrator and the engine read the same line.
function takeBack() {
    const c = ctx(), back = lineToTakeBack(c.chat ?? []);
    if (!back)
        return;
    const msg = c.chat[back.index];
    setTimeout(async () => {
        if (ctx().chat?.[back.index] !== msg)
            return;
        if (c.deleteMessage)
            await c.deleteMessage(back.index);
        else if (c.deleteLastMessage) {
            await c.deleteLastMessage();
            await c.saveChat?.();
        }
        else
            return;
        fillInput(back.text);
    }, 0);
}
function lastUserIndex() { const chat = ctx().chat ?? []; for (let i = chat.length - 1; i >= 0; i--)
    if (chat[i]?.is_user)
        return i; return -1; }
// Written while the reply is generated; SillyTavern saves the chat, the note with it, when the reply arrives.
function keepNote(note) {
    const msg = ctx().chat?.[lastUserIndex()];
    if (!msg)
        return;
    msg.extra ??= {};
    if (noteView(note, true))
        msg.extra[NOTE_KEY] = { ...note, line: String(msg.mes ?? '') };
    else
        delete msg.extra[NOTE_KEY];
    drawNotes();
}
function fillInput(text) {
    const box = document.getElementById('send_textarea');
    if (!box)
        return;
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
    box.setSelectionRange(text.length, text.length);
}
function drawNotes() {
    if (typeof document === 'undefined')
        return;
    document.querySelectorAll('#chat .rules-reading').forEach(e => e.remove());
    if (!settings().enabled)
        return;
    // The story's era sets the type; the theme's text colour, light or dark, sets the share each kind's colour takes.
    const look = { era: eraOf(storyYearNow()), tone: toneOf(getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBodyColor')) };
    for (const { index, view } of notesOf(ctx().chat ?? [])) {
        const at = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
        if (at)
            at.after(drawNote(document, view, look, fillInput));
    }
}
// How a line is said, marked without signs (src/rules/voice-code.ts, src/ui.ts): select words in the message box and a toolbar
// of plain words appears above it (the ♪ button by the box opens it for the word at the cursor); a pick marks the words with
// hidden codes, and a layer over the box underlines marked words in their group's soft colour. Sent, the line is typeset
// in the chat the way it sounds; before a model reads the chat, the codes become the notation the engine reads.
function buildVoice() {
    const form = document.getElementById('send_form'), box = document.getElementById('send_textarea');
    if (!form || !box || document.getElementById('rules-voice'))
        return;
    let pinned = false;
    const bar = document.createElement('div');
    bar.id = 'rules-voice';
    bar.hidden = true;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'How the selected words are said');
    const edit = (r) => {
        box.focus();
        if (!r)
            return;
        box.setSelectionRange(r.from, r.to);
        // insertText keeps the box's own undo (Ctrl+Z); setRangeText where a browser lacks it.
        if (!document.execCommand?.('insertText', false, r.insert))
            box.setRangeText(r.insert, r.from, r.to, 'end');
        box.setSelectionRange(r.selStart, r.selEnd);
        box.dispatchEvent(new Event('input', { bubbles: true }));
    };
    for (const g of VOICE_GROUPS) {
        const group = document.createElement('span');
        group.className = `rules-voice-group rules-hl-${g.family}`;
        const name = document.createElement('span');
        name.className = 'rules-voice-name';
        name.textContent = g.group;
        group.appendChild(name);
        for (const item of g.items) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'rules-voice-btn';
            const label = document.createElement('span');
            label.className = item.mark ? `rules-v rules-v-${item.mark}` : 'rules-v';
            label.textContent = item.label;
            b.appendChild(label);
            b.title = `${g.group}: ${item.label}`;
            // The box keeps its selection: the button takes no focus on press.
            b.addEventListener('mousedown', e => e.preventDefault());
            b.addEventListener('click', () => { edit(markWords(box.value, box.selectionStart, box.selectionEnd, item.id)); paint(); });
            group.appendChild(b);
        }
        bar.appendChild(group);
    }
    form.before(bar);
    // The ♪ button beside the box: opens the toolbar for the word at the cursor, and closes it.
    const note = document.createElement('div');
    note.id = 'rules-voice-open';
    note.className = 'fa-solid fa-music interactable';
    note.title = 'How your line is said';
    note.tabIndex = 0;
    note.setAttribute('role', 'button');
    note.setAttribute('aria-pressed', 'false');
    const toggle = () => { pinned = !pinned; show(); box.focus(); };
    note.addEventListener('mousedown', e => e.preventDefault());
    note.addEventListener('click', toggle);
    // Enter and Space press it from the keyboard, as a button (WAI-ARIA Authoring Practices, Button pattern).
    note.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
    } });
    (document.getElementById('leftSendForm') ?? form).appendChild(note);
    // Open while words are selected in the box, while the toolbar holds the focus (Tab from the box), or pinned by ♪.
    const show = () => { const focus = document.activeElement, sel = (focus === box || bar.contains(focus)) && box.selectionStart !== box.selectionEnd; bar.hidden = !(pinned || sel) || !settings().enabled; note.classList.toggle('rules-voice-on', pinned); note.setAttribute('aria-pressed', String(pinned)); };
    document.addEventListener('selectionchange', show);
    // Tab from the box enters the toolbar while it shows: the toolbar stands before the form, so the page's focus order passes it.
    box.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !bar.hidden) {
        e.preventDefault();
        bar.querySelector('button')?.focus();
    } });
    box.addEventListener('keyup', show);
    box.addEventListener('mouseup', show);
    box.addEventListener('blur', () => setTimeout(show, 0));
    bar.addEventListener('focusout', () => setTimeout(show, 0));
    // Backspace and Delete take a marked letter as one character (the browser alone takes one invisible code at a time).
    document.addEventListener('keydown', e => {
        const t = e.target;
        if (!(t instanceof HTMLTextAreaElement) || (t !== box && !t.classList.contains('edit_textarea')) || (e.key !== 'Backspace' && e.key !== 'Delete') || t.selectionStart !== t.selectionEnd || e.ctrlKey || e.altKey || e.metaKey)
            return;
        const r = keyDelete(t.value, t.selectionStart, e.key === 'Backspace');
        if (!r)
            return;
        e.preventDefault();
        t.setSelectionRange(r.from, r.to);
        const done = r.insert ? document.execCommand?.('insertText', false, r.insert) : document.execCommand?.('delete');
        if (!done) {
            t.setRangeText(r.insert, r.from, r.to, 'end');
            t.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, true);
    // The layer over the box: the same text, invisible, in the same type and place, marked words underlined; clicks pass through.
    const layer = document.createElement('div');
    layer.id = 'rules-voice-layer';
    layer.setAttribute('aria-hidden', 'true');
    form.classList.add('rules-voice-form');
    form.appendChild(layer);
    const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth'];
    const paint = () => {
        const v = box.value;
        if (!hasHidden(v)) {
            layer.replaceChildren();
            layer.hidden = true;
            return;
        }
        layer.hidden = false;
        const cs = getComputedStyle(box);
        for (const k of COPY)
            layer.style[k] = cs[k];
        layer.style.left = `${box.offsetLeft + box.clientLeft}px`;
        layer.style.top = `${box.offsetTop + box.clientTop}px`;
        layer.style.width = `${box.clientWidth}px`;
        layer.style.height = `${box.clientHeight}px`;
        layer.replaceChildren(...mirrorParts(v).map(p => { if (!p.family)
            return document.createTextNode(p.text); const s = document.createElement('span'); s.className = `rules-hl rules-hl-${p.family}`; s.textContent = p.text; return s; }));
        layer.scrollTop = box.scrollTop;
    };
    box.addEventListener('input', paint);
    box.addEventListener('scroll', () => { layer.scrollTop = box.scrollTop; });
    new ResizeObserver(paint).observe(box);
    paint();
}
/** The player's sent lines typeset the way they sound: each text node holding hidden marks in a player's message is rewritten
 * as the words with their marks' classes (src/ui.ts drawVoice); done again whenever the message is drawn. */
function typesetChat() {
    if (typeof document === 'undefined' || !settings().enabled)
        return;
    for (const mes of document.querySelectorAll('#chat .mes[is_user="true"] .mes_text')) {
        const walk = document.createTreeWalker(mes, NodeFilter.SHOW_TEXT), nodes = [];
        for (let n = walk.nextNode(); n; n = walk.nextNode())
            if (hasHidden(n.nodeValue ?? ''))
                nodes.push(n);
        for (const n of nodes)
            n.replaceWith(...drawVoice(document, n.nodeValue ?? ''));
    }
}
function registerTimeCommand() {
    const c = ctx();
    if (!c.SlashCommand || !c.SlashCommandParser)
        return;
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'rules-time',
        helpString: 'Show the story time, or set it: /rules-time 1850-03-14 18:40, /rules-time 1850-03-14, /rules-time Day 3 07:15. PassTime moves it on from there.',
        returns: 'the story time',
        callback: async (_args, value) => {
            const text = String(value ?? '').trim();
            if (text) {
                const t = parseStoryTime(text);
                if (t === null)
                    return 'Not a story time. Use 1850-03-14 18:40, 1850-03-14, or Day 3 07:15.';
                setStoryTime(t);
                refreshTime();
            }
            const now = storyTime();
            return now === null ? 'No story time set. Set one with /rules-time 1850-03-14 18:40.' : `Story time: ${formatStoryTime(now)}.`;
        },
    }));
}
function refreshTime() {
    const t = ctx().chatMetadata ? storyTime() : null;
    const el = document.getElementById('rules_engine_time');
    if (el && document.activeElement !== el)
        el.value = t === null ? '' : formatStoryTime(t);
}
async function buildSettings() {
    const html = await ctx().renderExtensionTemplateAsync(`third-party/${folder()}`, 'settings');
    document.getElementById('extensions_settings2')?.insertAdjacentHTML('beforeend', html);
    const s = settings();
    const bind = (id, key, after) => {
        const el = document.getElementById(id);
        el.checked = s[key];
        el.addEventListener('change', () => { settings()[key] = el.checked; ctx().saveSettingsDebounced(); after?.(); });
    };
    bind('rules_engine_enabled', 'enabled', () => registerRulesTools(settings().enabled));
    bind('rules_engine_question_pass', 'questionPass');
    bind('rules_engine_rule_check', 'ruleCheck');
    if (document.getElementById('rules_engine_structured'))
        bind('rules_engine_structured', 'structured');
    if (document.getElementById('rules_engine_suggest'))
        bind('rules_engine_suggest', 'suggest');
    const profile = document.getElementById('rules_engine_profile');
    const profiles = ctx().extensionSettings.connectionManager?.profiles ?? [];
    for (const p of profiles)
        profile.add(new Option(p.name, p.id));
    profile.value = profiles.some(p => p.id === s.profile) ? s.profile : '';
    profile.addEventListener('change', () => { settings().profile = profile.value; ctx().saveSettingsDebounced(); });
    const tokens = document.getElementById('rules_engine_max_tokens');
    tokens.value = String(s.maxTokens || '');
    tokens.addEventListener('change', () => { settings().maxTokens = Math.max(0, Number(tokens.value) || 0); ctx().saveSettingsDebounced(); });
    const effort = document.getElementById('rules_engine_effort');
    if (effort) {
        effort.value = s.effort ?? 'low';
        effort.addEventListener('change', () => { settings().effort = effort.value; ctx().saveSettingsDebounced(); });
    }
    const time = document.getElementById('rules_engine_time');
    time.addEventListener('change', () => {
        const t = parseStoryTime(time.value);
        if (t === null) {
            toastr.warning('Use 1850-03-14 18:40, 1850-03-14, or Day 3 07:15.', 'Story time');
            refreshTime();
            return;
        }
        if (ctx().chatMetadata) {
            setStoryTime(t);
            refreshTime();
        }
    });
    refreshTime();
    const line = document.getElementById('rules_engine_world_line');
    document.getElementById('rules_engine_world_fill')?.addEventListener('click', () => {
        if (!line.value.trim())
            return;
        void addEntry(line.value.trim()).then(msg => { toastr.info(msg, 'World book'); line.value = ''; });
    });
    renderBook();
}
/** This extension's folder under scripts/extensions/third-party, from the URL this module loaded from. */
const folder = () => decodeURIComponent(new URL('.', import.meta.url).pathname.replace(/\/src\/$/, '').split('/').pop() || NAME);
// Structured narration (narration.ts) on the main reply: when the question pass decided this turn and the connection takes
// a schema, the reply's request carries the beats schema; the reply is read into prose when it arrives.
const SUGGEST_LINE = 'They are what the real world of this time and place would most likely give. Take each as a suggestion: keep it where this world and the story agree with it, and change it where they differ.';
const SUGGEST_BRIEF = `<rule_engine>
This story's world departs from real history. The rule engine works out what the real world of the story's time and place would most likely give ([DECIDED]); this world's own rules, its world book and the story come first. Use each outcome as a guide to likelihood and detail, and keep the story's own laws and established facts. [BODY], [TIME] and the belongings list hold what the engine recorded; where the story has already told an outcome differently, the story's version stands.
</rule_engine>`;
const structuredNow = () => { const s = settings(); return s.enabled && s.structured && !s.suggest && s.questionPass && GUIDED && questionPassRan(); };
function addReplySchema(data) {
    if (!structuredNow())
        return;
    const schema = narrationSchema(decidedResults().length), rf = { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema } };
    data.response_format = rf;
    data.json_schema = { name: 'reply', strict: true, value: schema };
    if (data.chat_completion_source === 'custom')
        data.custom_include_body = `${String(data.custom_include_body ?? '').trim()}${data.custom_include_body ? '\n' : ''}response_format: ${JSON.stringify(rf)}`;
}
function readReply(id) {
    const c = ctx();
    const msg = c.chat?.[id];
    if (!msg || msg.is_user || msg.is_system)
        return;
    const nar = readNarration(msg.mes);
    if (!nar) {
        setOpen([]);
        return;
    }
    msg.mes = proseOf(nar);
    msg.extra ??= {};
    (msg.extra.rulesNarration ??= {})[msg.swipe_id ?? 0] = nar;
    setOpen(nar.open ?? []);
    try {
        c.updateMessageBlock?.(id, msg);
    }
    catch { /* the block is drawn after this event */ }
    c.saveChatDebounced?.();
}
function wireEvents() {
    const c = ctx(), on = c.eventSource.on.bind(c.eventSource), ev = c.eventTypes;
    const live = () => settings().enabled && !!ctx().chatMetadata;
    // First of the reply's handlers: the rule check and the saved state read the prose.
    on(ev.MESSAGE_RECEIVED, (id) => { if (live())
        readReply(id); });
    if (ev.CHAT_COMPLETION_SETTINGS_READY)
        on(ev.CHAT_COMPLETION_SETTINGS_READY, (data) => { if (live())
            addReplySchema(data); });
    // Every request to a model leaves with the player's hidden marks as notation, whoever built it: the interceptor notates the
    // reply's own chat, and an extension's raw prompt (the summary's "raw" builder) reads the lines as saved.
    for (const e of [ev.CHAT_COMPLETION_SETTINGS_READY, ev.TEXT_COMPLETION_SETTINGS_READY])
        if (e)
            on(e, (data) => notateRequest(data));
    on(ev.GENERATION_STARTED, (type) => { if (live())
        onRulesGenerationStarted(type); });
    on(ev.MESSAGE_RECEIVED, (id) => { if (live())
        onRulesMessageReceived(id); });
    on(ev.MESSAGE_RECEIVED, async (id) => {
        // A greeting has no player turn to check against.
        if (!live() || !settings().ruleCheck || settings().suggest || !ctx().chat.some(m => m.is_user))
            return;
        const chatId = ctx().getCurrentChatId();
        const ownsChat = () => ctx().getCurrentChatId() === chatId;
        await onRulesAuditMessage(id, {
            send, ownsChat,
            generate: type => setTimeout(() => { if (ownsChat())
                void Promise.resolve(ctx().generate(type)).catch(e => console.error('[Rules engine] redo failed:', e)); }, 75),
            toast: text => toastr.warning(text, 'Rule check', { timeOut: 12000 }),
        }).catch(e => console.warn('[Rules engine] rule check skipped:', e));
    });
    on(ev.MESSAGE_SWIPED, (id) => { if (live())
        onRulesSwiped(id); });
    on(ev.CHAT_CHANGED, () => { if (live())
        syncRulesToChat(); refreshTime(); applyWorld(getBook()); renderBook(); drawNotes(); typesetChat(); });
    on(ev.MESSAGE_DELETED, () => { if (live())
        syncRulesToChat(); drawNotes(); });
    // The reading notes follow the chat as it is drawn: a new or re-drawn message, older messages loaded, an edit (a line
    // edited since its reading shows no note, ui.ts notesOf).
    for (const e of [ev.USER_MESSAGE_RENDERED, ev.CHARACTER_MESSAGE_RENDERED, ev.MESSAGE_UPDATED, ev.MORE_MESSAGES_LOADED])
        if (e)
            on(e, () => { drawNotes(); typesetChat(); });
    // PassTime moves the clock; the field follows after each reply.
    on(ev.MESSAGE_RECEIVED, () => refreshTime());
}
(async () => {
    registerRulesTools(settings().enabled);
    // Constrained decoding on by default; a connection that refuses it turns it off on the first refusal (send above).
    setGuided(true);
    void loadColex();
    void loadLanguageYears();
    void loadThings();
    void loadChat();
    void loadPopulation();
    wireEvents();
    registerRulesStatsCommand();
    const c = ctx();
    c.SlashCommandParser?.addCommandObject(c.SlashCommand.fromProps({ name: 'rules-pulse-test', helpString: 'Runs the body simulation (Pulse) for 2 minutes of a leg bleed and reports the vital signs and the time it took.', callback: async () => {
            // A command's return value is not shown in the chat, so the result appears as a notice that stays until tapped.
            const t = globalThis.toastr;
            t?.info('Pulse test running (up to a minute)…');
            const r = await pulseSelfTest();
            t?.success(r, 'Pulse', { timeOut: 0, extendedTimeOut: 0 });
            return r;
        } }));
    c.SlashCommandParser?.addCommandObject(c.SlashCommand.fromProps({ name: 'rules-replay', helpString: 'Replays every recorded change of the world and says whether it rebuilds the current state exactly.', callback: async () => {
            const r = historyCheck();
            globalThis.toastr?.success(r, 'History', { timeOut: 0, extendedTimeOut: 0 });
            return r;
        } }));
    c.SlashCommandParser?.addCommandObject(c.SlashCommand.fromProps({ name: 'rules-log', helpString: 'This turn\'s decisions: each call, its arguments, the random draws it used and its result.', callback: async () => turnLog() }));
    registerRulesEvalCommand(send);
    registerTimeCommand();
    registerWorldCommands();
    await buildSettings();
    try {
        buildVoice();
    }
    catch (e) {
        console.warn('[Rules engine] voice toolbar skipped:', e);
    }
    applyWorld(getBook());
    console.log(`[Rules engine] loaded: ${REGISTRY.size} tools`);
})();
