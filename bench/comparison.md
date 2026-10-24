# Human vs Seyrin

**Human times are modeled, not measured.** Each step is built from published rates (KLM operator times, reading and composing speed) or a labelled assumption; the range is the low and high case. **Seyrin times are measured** from this run's task timestamps and Kane NDJSON. "Your attention" is the modeled time you still spend reading Seyrin's card, approving and sending.

| Request | By hand (typical, range) | Seyrin end to end (measured) | Your attention with Seyrin | Attention saved |
|---|---|---|---|---|
| One-pager for the Acme Yoga pilot (document, done) | 24.9 min (15.2 min–44.3 min) | 49 s, 1 Kane run | 34 s | 98% |
| Upgrade button does nothing (bug report, done) | 27.3 min (12.8 min–56.3 min) | 2 min, 2 Kane runs | 29 s | 98% |
| Pro price → $15 (site change, done) | 4.8 min (2.5 min–9.6 min) | 37 s, 1 Kane run | 28 s | 90% |
| Can't create an account with my email (bug report, done) | 27.4 min (12.9 min–56.3 min) | 2.1 min, 2 Kane runs | 29 s | 98% |
| Pricing page is blank for me (bug report, not reproduced) | 3.8 min (2.3 min–6.9 min) | 34 s, 1 Kane run | 29 s | 87% |
| **All 5 tasks** | **88.2 min** | **6.1 min** | **2.5 min** | **97%** |

Every Seyrin result above was checked by Kane in a real browser before it was called done. The by-hand times assume no interruption; resuming interrupted work averages 23 min 15 s (Mark et al.), which a person handling inbox requests pays far more often than Seyrin.

## How the by-hand times are built

Rates (bench/rates.json): reading 238 wpm, copying 52 wpm, composing 30 wpm, KLM keystroke 0.2 s, point 1.1 s, click 0.2 s, home 0.4 s, mental preparation 1.35 s.

- **readingWpm:** Silent reading of non-fiction, adults: Brysbaert (2019) meta-analysis of 190 studies.
- **transcribeWpm:** Average of 168,000 people typing online: Dhakal et al. (CHI 2018), reported as 52 wpm.
- **composeWpm:** Composing is slower than copying because you think while you type. Derived: 52 wpm x 0.58, the composing-to-copying ratio Karat et al. measured (19 / 32.5). Edit this if you have your own number.
- **klm:** Keystroke-Level Model operator times (Card, Moran & Newell). K set to 0.2 s, a 52 wpm typist (60 / (52 x 5 characters) = 0.23 s, rounded toward the model's skilled band).
- **writing:** Writing is planning, drafting and reviewing (Hayes & Flower's model of the writing process). Drafting uses composeWpm. Planning is an assumption: 45 s to decide what a short reply says, 4 min to outline a one-pager. Refining is re-reading the draft twice at readingWpm and retyping about 20% of it at transcribeWpm (assumption).
- **Hayes & Flower (1980)** describe writing as planning, translating and reviewing; the model gives the structure, the durations above are estimates.

### One-pager for the Acme Yoga pilot

| Step | Typical | Basis |
|---|---|---|
| Read the email | 14 s | 49 words at 238 wpm |
| Gather the facts (pricing, dates, contact) | 2 min | Assumption: look up pricing and re-read the request |
| Think about what to say (the one-pager) | 4 min | Assumption: planning before typing (see rates.json) |
| Draft the one-pager: 300 words | 10 min | 300 words at 30 wpm composing |
| Re-read and refine the one-pager | 3.6 min | 2 read-throughs at 238 wpm plus retyping 20% of it |
| Format headings and check every section is there | 78 s | KLM plus a minute of formatting (assumption) |
| Check the numbers against the email | 88 s | Re-reading at 238 wpm |
| Share the document | 9 s | KLM |
| Think about what to say (the reply) | 45 s | Assumption: planning before typing (see rates.json) |
| Draft the reply: 30 words | 60 s | 30 words at 30 wpm composing |
| Re-read and refine the reply | 24 s | 2 read-throughs at 238 wpm plus retyping 20% of it |

### Upgrade button does nothing

| Step | Typical | Basis |
|---|---|---|
| Read the email | 10 s | 34 words at 238 wpm |
| Open the app at the reported page | 13 s | KLM: point, click, type the URL, page load (assumed 2 s) |
| Follow the steps and try again a few times | 28 s | KLM: 3 attempts, each a click plus about 5 s watching (assumption) |
| Open devtools and check the console | 21 s | KLM plus about 15 s reading the console (assumption) |
| Find the code behind the button | 3 min | Assumption: search the repo for the handler in a small app |
| Work out why it fails | 5 min | Assumption: a one-line bug (wrong data attribute) in a 30-line file |
| Edit, save and reload | 15 s | KLM |
| Re-test the customer’s steps | 16 s | KLM |
| Write a regression test for it | 15 min | Assumption: a Playwright test for one flow, from scratch |
| Think about what to say (the reply) | 45 s | Assumption: planning before typing (see rates.json) |
| Draft the reply: 40 words | 80 s | 40 words at 30 wpm composing |
| Re-read and refine the reply | 31 s | 2 read-throughs at 238 wpm plus retyping 20% of it |

### Pro price → $15

| Step | Typical | Basis |
|---|---|---|
| Read the email | 6 s | 19 words at 238 wpm |
| Open the repo and find where the price is set | 2 min | Assumption: the price appears in the page and in the checkout script |
| Edit both places and save | 16 s | KLM |
| Run the site and check the pricing page and checkout | 32 s | KLM plus about 20 s to start the server (assumption) |
| Think about what to say (the reply) | 45 s | Assumption: planning before typing (see rates.json) |
| Draft the reply: 25 words | 50 s | 25 words at 30 wpm composing |
| Re-read and refine the reply | 20 s | 2 read-throughs at 238 wpm plus retyping 20% of it |

### Can't create an account with my email

| Step | Typical | Basis |
|---|---|---|
| Read the email | 12 s | 41 words at 238 wpm |
| Open the app at the reported page | 13 s | KLM: point, click, type the URL, page load (assumed 2 s) |
| Follow the steps and try again a few times | 28 s | KLM: 3 attempts, each a click plus about 5 s watching (assumption) |
| Open devtools and check the console | 21 s | KLM plus about 15 s reading the console (assumption) |
| Find the code behind the button | 3 min | Assumption: search the repo for the handler in a small app |
| Work out why it fails | 5 min | Assumption: a one-line bug (wrong data attribute) in a 30-line file |
| Edit, save and reload | 15 s | KLM |
| Re-test the customer’s steps | 16 s | KLM |
| Write a regression test for it | 15 min | Assumption: a Playwright test for one flow, from scratch |
| Think about what to say (the reply) | 45 s | Assumption: planning before typing (see rates.json) |
| Draft the reply: 40 words | 80 s | 40 words at 30 wpm composing |
| Re-read and refine the reply | 31 s | 2 read-throughs at 238 wpm plus retyping 20% of it |

### Pricing page is blank for me

| Step | Typical | Basis |
|---|---|---|
| Read the email | 10 s | 33 words at 238 wpm |
| Open the app at the reported page | 13 s | KLM: point, click, type the URL, page load (assumed 2 s) |
| Follow the steps and try again a few times | 28 s | KLM: 3 attempts, each a click plus about 5 s watching (assumption) |
| Open devtools and check the console | 21 s | KLM plus about 15 s reading the console (assumption) |
| Think about what to say (the reply) | 45 s | Assumption: planning before typing (see rates.json) |
| Draft the reply: 40 words | 80 s | 40 words at 30 wpm composing |
| Re-read and refine the reply | 31 s | 2 read-throughs at 238 wpm plus retyping 20% of it |

## Sources

- [Card, Moran & Newell (1980), The Keystroke-Level Model](https://en.wikipedia.org/wiki/Keystroke-level_model)
- [Brysbaert (2019), How many words do we read per minute?](https://doi.org/10.1016/j.jml.2019.104047)
- [Dhakal, Feit, Kristensson & Oulasvirta (CHI 2018), Observations on Typing from 136 Million Keystrokes: average 52 wpm](https://userinterfaces.aalto.fi/136Mkeystrokes/)
- [Karat et al. (1999): composing runs at about 0.58 of copying speed (used only as a ratio)](https://www.humanfactors.com/newsletters/human_interaction_speeds.html)
- [Mark, Gonzalez & Harris (2005), via Gallup: interrupted work resumed after 23 min 15 s on average](https://news.gallup.com/businessjournal/23146/too-many-interruptions-work.aspx)
