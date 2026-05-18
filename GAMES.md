# Mini-Game Concepts

The SSCP Gauntlet rotates mini-games every batch of 10 questions to keep practice from feeling like a flashcard grind. This document is the canonical list of game ideas — pick from here when adding new ones.

Status legend: ✅ shipped · 🚧 in progress · 💡 idea

---

## Currently Implemented

| # | Name | Status | Notes |
|---|------|--------|-------|
| 9 | Tower Defense: Exploit Wave | ✅ | Player-selectable from the menu. |
| 10 | Hacker Boss Duel | ✅ | Player-selectable from the menu. |
| 17 | Vault Lockdown | ✅ | Player-selectable from the menu. |
| — | Asteroid Answer Run | 💡 hidden | Earlier prototype; still in the codebase, removed from the menu. |

---

## Reflex / arcade

### 1. Endless Lane Runner 💡
**Mechanic.** Vertical scrolling. Character runs forward across 4 lanes. Answer gates approach; switch lanes (`A`/`D` or `←`/`→`) to pass through the correct one.
**Question payload.** The 4 options become the lane gate labels.
**Why it works.** Pure reaction + recognition. Pace ramps with the streak; no debris noise (unlike Asteroid Run).

### 2. Whack-a-Threat 💡
**Mechanic.** Moles labeled with threat names (DDoS, phishing, MITM, SQLi…) pop up around a SOC dashboard. Tap only the ones matching the prompt.
**Question payload.** Category-rule prompt ("Tap all volumetric attacks") plus 6–8 mole labels per round.
**Why it works.** Reaction + categorization. Good for distinguishing similar-sounding terms.

### 3. Brick-Breaker Firewall 💡
**Mechanic.** Paddle below, 4 answer bricks above. Deflect a probe-projectile so it strikes the correct brick. Wrong brick shrinks the paddle; hitting the floor loses a life.
**Question payload.** 4 options become bricks; stem displayed above.
**Why it works.** Classic arcade feel, slow enough to actually read the bricks.

---

## Puzzle / sorting

### 4. Packet Sorter (conveyor belt) 💡
**Mechanic.** Packets glide along a conveyor with metadata badges (port, payload, source). Drag each into the correct outbound lane before it drops off the belt.
**Question payload.** A sorting rule ("Send TLS-bound packets to DMZ") plus 6–10 packet objects.
**Why it works.** Forces sustained classification, not single-shot recognition.

### 5. OSI Layer Climber 💡
**Mechanic.** Vertical stack of 7 platforms (Physical → Application). Protocol/attack cards fall from the top; drop each on the correct layer before the pile reaches the top.
**Question payload.** A batch of items to classify by layer.
**Why it works.** Reinforces the OSI model in a way pure MCQ never can.

### 6. Pipeline Builder 💡
**Mechanic.** A scenario is described ("Contain a ransomware outbreak"). Drag 4–6 step cards into the correct order.
**Question payload.** Scenario + an ordered list of correct steps (a new question variant — not standard MCQ).
**Why it works.** Best for process-heavy domains like Incident Response.

---

## Memory / matching

### 7. Crypto Memory Grid 💡
**Mechanic.** 4×3 tile grid. Flip pairs to match a term (e.g., "AES-256") to its definition. Limited flips per question.
**Question payload.** A small word-bank pulled from a question's terms.
**Why it works.** Drills terminology recognition under time pressure.

### 8. Cipher Cracker 💡
**Mechanic.** A short Caesar / substitution puzzle. The multiple-choice answer reveals the *key* to apply ("Which cipher uses a 13-shift?" → answer ⇒ key 13 → decode the message to score).
**Question payload.** MCQ + a tiny encoded string per round.
**Why it works.** Teaches cipher mechanics, not just trivia. High-engagement.

---

## Strategy / decision

### 9. Tower Defense: Exploit Wave 🚧 (main v1 game)
**Mechanic.** A path winds toward the "server core" on the right. Each question = one wave. The 4 answer options are 4 tower types. Click your answer; that tower is placed at the path's defense slots and the wave begins. Wrong-answer towers misfire (reduced damage), so more exploits reach the core. Core HP visible top-of-screen.
**Question payload.** Standard MCQ. Answer text is shown on each tower card.
**Why it works.** The strategic feel makes the consequence of a wrong answer feel earned, not punishing. Visually rich, low dexterity demand.

### 10. Hacker Boss Duel 💡
**Mechanic.** RPG combat. HP bars for player and boss. Each question is your attack roll — correct = damage, streak combos = crits, wrong = boss counter-attacks. Four themed bosses (Ransomware Wraith, Cipher Lich, Insider Spectre, Packet Hydra), one per domain group.
**Question payload.** Plain MCQ wrapped in narrative flavor.
**Why it works.** High theatrical impact, cheapest to build (mostly UI over the existing question flow).

### 13. Network Conquest 💡
**Mechanic.** Risk-style map of ~10 zones (DMZ, Corp LAN, Cloud, OT, Endpoint, etc.). Each turn the attacker AI threatens one zone; the 4 answer options are 4 defensive postures (segment / patch / monitor / harden). Correct answer holds the zone; wrong answer the zone flips red. Win = own majority at run end.
**Question payload.** Standard MCQ; the zone under attack flavors the stem.
**Why it works.** Persistent map state across all 30 questions makes early mistakes visible later — promotes strategic recovery, not just per-question reflex.

### 14. Budget Bunker 💡
**Mechanic.** Start each batch with a fixed security budget (e.g. 10 points). The 4 answer options are 4 spending choices of varying cost (1–4 pts each). Correct answer = the spend succeeds and adds a permanent control card to your bunker; wrong answer = the spend is wasted. At end of run, an incident-storm phase rolls each control vs. random threats — your final score is what survives.
**Question payload.** Standard MCQ; option text framed as a control purchase.
**Why it works.** Forces real CISO-style trade-offs (broad cheap vs. narrow expensive) and ties question accuracy to a tangible end-game payoff.

### 15. Patch Tuesday Deckbuilder 💡
**Mechanic.** Lightweight deckbuilder. Player starts with a 5-card hand of generic controls. Each question is a CVE drop — correct answer lets you *draft* one of the 4 options into your deck; wrong answer adds a "tech debt" card that clogs future hands. Between batches, your deck auto-plays against a scripted exploit wave; survivors carry over.
**Question payload.** Standard MCQ; option text doubles as the card name.
**Why it works.** Long-arc progression — players feel their early decisions compound. Deck-building is inherently replayable, good for repeat runs.

### 16. Red Team Heist (asymmetric) 💡
**Mechanic.** Flip the perspective: player is the attacker climbing a 7-step kill chain (Recon → Weaponization → Delivery → Exploit → Install → C2 → Exfil). Each question's 4 options are 4 candidate techniques; correct = advance one step, wrong = the blue team logs you and adds a detection rule that costs +1 correct answer to bypass next step. Goal: exfil before the run ends.
**Question payload.** Standard MCQ; stems re-themed from the attacker's viewpoint.
**Why it works.** Teaches the kill chain from the inside out, a perspective rarely drilled in flashcards. Asymmetric framing breaks up the "I'm the defender" monotony of every other game.

### 17. Vault Lockdown 💡
**Mechanic.** A central crown-jewel asset surrounded by 6 radial attack paths. Each path has 3 distance rings. Every question, the attacker advances one ring on a random path; a correct answer lets you place a single lock anywhere on the board (locks freeze that path's advance). Wrong = no lock placed and the attacker advances an extra ring. Vault falls if any path reaches the center.
**Question payload.** Standard MCQ; flavor text names the threat moving on the highlighted path.
**Why it works.** Forces spatial prioritization — do you reinforce the closest path or the most-attacked one? Visible board state makes the consequence of each wrong answer feel earned.

---

## Simulation / scenario

### 11. SOC Triage 💡
**Mechanic.** Alert tickets stream into an incident dashboard. For each ticket, classify it: True Positive / False Positive / Informational / Escalate. Timer per ticket.
**Question payload.** Ticket content + correct classification — needs a non-MCQ generator template.
**Why it works.** Closest to real SOC work. Strong for Risk + Incident Response domains.

### 12. Phishing Inbox 💡
**Mechanic.** Emails land in an inbox. Mark each Phish or Legit; click on the specific red flag (sender mismatch, suspicious URL, urgency, attachments) for bonus points.
**Question payload.** Email object (sender, subject, body, links) + correct verdict and indicator — needs a non-MCQ generator template.
**Why it works.** Skill the SSCP actually tests behaviorally, not just on paper.

---

## Building a balanced rotation

A good 3-game rotation hits different muscles so a 30-question run never feels monotonous. Some natural mixes:

- **Reflex + Puzzle + Strategy** — #1 Lane Runner · #4 Packet Sorter · #9 Tower Defense
- **Reflex + Memory + Simulation** — #2 Whack-a-Threat · #7 Memory Grid · #11 SOC Triage
- **Heavy theme + variety** — #8 Cipher Cracker · #6 Pipeline Builder · #10 Boss Duel

## Cost notes

| Game | Build cost | Content cost |
|------|------------|--------------|
| #10 Boss Duel | Cheapest — mostly UI over existing question flow. | Standard MCQ. |
| #9 Tower Defense | Medium — needs path/creep/projectile logic. | Standard MCQ. |
| #2 Whack-a-Threat, #5 OSI Climber | Medium. | Needs categorization question variant. |
| #11 SOC Triage, #12 Phishing Inbox | Medium-high. | Needs scenario/email content generator (second LLM prompt template). |
| #6 Pipeline Builder | Medium. | Needs ordered-list question variant. |
| #8 Cipher Cracker | High — puzzle generator on top of MCQ. | MCQ + encoded string. |
