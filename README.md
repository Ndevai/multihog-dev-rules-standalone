# Rules Engine for SillyTavern

Code decides outcomes; the narrator writes them. Each turn:

1. **Question pass.** One model call reads the scene and names the outcomes in doubt (a climb that may fail, a sound that may be missed, a price, time passing). The engine decides each with its rule tools.
2. **Narration.** The narrator gets one system message: the story time, each tracked body, what each character knows, and the decided outcomes ([DECIDED]). Your prompt, card and preset stay as they are.
3. **Rule check.** One model call compares the reply with the decided outcomes and redoes the reply once when it contradicts one.

## Install

1. SillyTavern → Extensions → Install extension.
2. URL `https://github.com/Ndevai/multihog-dev`, branch `rules-standalone`.
3. AI Response Configuration → tick **Enable function calling** (used when the question pass is off or fails).
4. Extensions → **Rules Engine**: the three boxes are on by default.
5. Give the chat a date and place. Type `/rules-time 1850-03-14 18:40` (or `Day 1 08:00`), or let the scenario state them ("London, 14 March 1850, evening"). The weather, prices and daylight need both. The time is read on the place's own clock for that date (summer time, or local mean time before standard time), and daylight follows the Sun and the recorded cloud of that hour. Characters placed on the map (Layout) hear and see what others do nearby, through walls and over a room's noise.

Tested with GLM-5.3 on NVIDIA's API (structured output on). A model without JSON-schema output reads the plan less reliably.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Rules engine | on | registers the tools and sends the engine's message each turn |
| Question pass | on | one model call before each reply |
| Rule check | on | one model call after each reply |
| Connection | same as the chat | a Connection Manager profile for the two extra calls (e.g. a faster model) |
| Reply length | the connection's own | max tokens for the two extra calls |
| Rules as suggestions | off | for a world far from real history: the outcomes reach the narrator as likely rather than fixed, the story and world book decide, and the rule check redoes nothing |

## Commands

| Command | What it does |
|---|---|
| `/rules-time [time]` | show or set the story time |
| `/rules-log` | this turn's decisions: each call, its arguments, its random draws and result |
| `/rules-replay` | replays every recorded change and says whether it rebuilds the current state |
| `/world-add <line>` | add a line to this card's world book; the model drafts the entry, you approve it |
| `/world-without <person>, <year>` | removes a person from history from that year; their inventions go to others, later, or never |
| `/world-event <event>; <people>; <year>` | removes the named people from that year |
| `/world-earlier <invention>, <year>` | brings an invention earlier, if a first inventor that far ahead is drawn |
| `/world-list` | shows the world book |

## Good to know

- Every number the engine uses has a published source or is marked [ASSUMED]. Sources and decisions: `docs/progress.md`, `docs/df-body-engine.md`; coverage: `docs/features.md`.
- Each turn costs two extra model calls (question pass and rule check), three when the rule check redoes a reply.
- A refused outcome ("State unchanged") is the engine asking for a missing number; the question pass asks again once.
- Under your message a folded line shows how the engine read it, one tagged call each ("Sight Tom · 15 m", "Body vault the low wall · 46 %"), the tag's colour for the kind of rule; click it to open, hover a row to see the rule call. It stays with the message, in a book serif that follows the story's era (Garamond for the 1500s, the Fell types, Baskerville, a Victorian Modern, Caslon; Georgia from 1970 or with no date). When your words leave a choice open, the likeliest reading is taken and shown ("☞ walk after the thief in the open — or…") unless a wrong guess would hurt someone ("I hit him" with two men at the bar, or "I look at Tom and Will, then I punch him"): then the engine asks in a sentence ("Do you mean to hit ¹Tom or ²Will?"; click or press the number), or "Say it another way" stops the reply. Opened, a guess offers the others as links; one puts "no, catch up with the thief" in your input box. That line, or one of your own such as "no, Will" or "I meant to keep out of sight", redoes the last turn that way.
- How you say a line: select words in the message box and pick from the toolbar that appears (rises, louder, softer, whispered, slower, a pause, breathy, smiling, a breath in, angry…), or press ♪ beside the box for the word at the cursor; Tab from the box enters the toolbar while it shows. The marks stay out of sight: the box shows your words, the marked ones softly underlined, and the chat sets your line the way it sounds. The engine reads every mark exactly: a whispered or shouted line carries as far as that voice does, and the listener hears your feeling right as often as people do, sometimes hearing another.
- "Say it another way" puts your line back in the box, marks and all, and takes it out of the chat; the next line stands in its place.
- People placed on the map overhear what is said near them, as far as the voice carries to each, and remember what they make out.
- Water below 0 °C is not ice by its temperature alone: the Substance lookup decides whether it freezes from how much there is, what is in it and how long it has been cold, so a cloud droplet at −1 °C stays liquid, a bucket freezes, and water touching frost freezes at once.
- For people placed on the map, a blow, a choke hold, a pistol shot, a chase, a look, speech and a sound take their distance and walls from the map, not from the reply's words: a punch thrown across the room falls short and says which walk closes the gap, and a wall with every door shut stops a blow or a shot.
- Code writes calls for your character's own acts: in "Tom punches Mara" or "I tell Will to wait an hour" the other person's act is read from the scene; "she" in a line written in the third person is your character when the line names no one else she could be. Acts the line says are not done ("I don't hit him", "I almost fall") and out-of-character asides ("(OOC: …)") are not acted on. Typed ›guillemets‹, «guillemets» and „German quotes“ are quotation marks, read as speech like "…", and capitals read as louder on common words only (STOP, NOOOO; NATO and ICU stay as written, and so do the WHO and the IT desk). You can speak to a group as to a person ("I shout to the crew", "I tell the town council"), and to someone named with their looks ("the old blind beggar").
- A line in the third person ("Mara climbs the wall") or in asterisks is read by its verbs like one in the first person, and words in bold or italics ("I punch **Tom**", "I _whisper_ to Will") are read as the words; a line that opens "No, I …" or "No, Will is …" is an ordinary line, and only a short "no, Will" or "I meant …" redoes the last turn. Regenerating after a reply that failed or was stopped, or pressing Send with the box empty, runs the turn once; a line edited first runs as edited. Deleting a reply keeps what your line did: the line stays in the chat. Each line keeps the world it started from, so a swipe, a regenerate or a "no, Will" starts from the line itself, also after messages before or after it are deleted. Curly apostrophes read as straight ones ("I’ll punch him"). A number in brackets ("Tom (35)") and a temperature ("20 °C") stay words; "I drop the sword" and "I fall asleep" are no falls. "I sit by the fire for an hour" passes the hour, "I swing my axe at the orc" is a blow, and "I give Will 3 coins" hands three. "I fire my pistol at the guard", "I open fire" and "I gun him down" are shots, a handgun's among them; "I fire the cook", "I fire the kiln" and "I hold my fire" are none, and "a shot of whiskey" is a measure. The models are shown only the options a scene can hold: an 1850 scene is offered no sneakers, antibiotics or spells, and the narrator gets the tools your line needs. Results reach the narrator as what happened and why, without sound levels, status tags or chances. A verb is read by what its object is: "I charge the cook two shillings" is a price, "I hold a meeting" is no grip, "I cut the cook" cannot break him like a plank, and "I charge the cook" is left to the scene, which weighs it: a sword in your hand, a fight going on, the words around it and how "charge" was meant earlier in the chat each make one reading likelier. "I run" runs at the pace runners choose, "I dash" sprints and "I hurry" walks as fast as you can walk; "5 m to the door, then 10 m to the gate" is walked in both legs.
- The tools a turn is offered follow the scene as well as your verbs: smoke in the hallway, a freezing lake, a desert at noon, a camp at 4,500 m, a sentry on gravel, a guard who shouted, a pan on the fire each add the tool that decides them. Sneaking, riding, crafts, riddles, sums, feelings, names, trust, a faint, clothes taken off, your character's own claims ("I am a cat", "she pulls a revolver from her coat") and a thing that cuts ("a shard slices her palm") route to their tools; reading a map, smelling or tasting route nothing. A shelf asked to hold your weight, someone else's feelings asked about ("does the guard like me"), tiptoeing, and a purse the narrator has your character slide into her sleeve each reach the tool that decides or records them.
- A result that ends "Fragile: …" rests on a judged value: within that value's range the outcome comes out otherwise. A room emptying through one door takes a few seconds to work out, the reruns for its judged values included.

License: GPL-3.0 (derived from the Multihog D&D Framework). Third-party data, code and fonts (SIL Open Font License, `fonts/`): `docs/third-party.md`. Your line is read by English grammar as Huddleston & Pullum's *Cambridge Grammar of the English Language* (2002) describes it: "give Tom a kick" is a kick, "I make Tom walk" is Tom's walk, "I fail to climb" is no climb, "him" is the one man named before, "I walk to the market every day" is a habit and no walk now, "Do I walk to the door?" asks, and "give the coin to Tom" hands it over. Before that, the line is read for what you meant: a slip is the word the scene makes likeliest, "again" is your last act, "him back" is whoever just struck you, and a goal you stated fills a later search; each reading is shown under your line. Word meanings come from VerbNet 3.4 (University of Colorado), FrameNet 1.7 (https://framenet.icsi.berkeley.edu; Fillmore & Baker 2010, "A Frame Semantic Approach to Linguistic Analysis", The Oxford Handbook of Linguistic Analysis) and Open English WordNet 2024 (CC BY 4.0).
