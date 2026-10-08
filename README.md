# FELT. — Friends Edition

A complete browser-based private Texas Hold'em table for 2–8 people, using **free, nonredeemable play chips**. No purchases, wagers, prizes, or real-money transactions.

## Features

- Private five-character room codes and shareable invite links
- Fully synchronized multiplayer poker using Socket.IO
- Two private hole cards per player, five shared community cards
- 10/20 blinds, rotating dealer, betting rounds and automatic showdowns
- Fold, check, call, bet/raise, and all-in actions
- Correct seven-card hand comparisons, side pots, and split pots
- 75-second turn timer (automatic check or fold if time runs out)
- Rejoin a room after refreshing your browser (while the server stays up)
- Table chat, player list, chip stacks, and mobile-friendly interface
- Refill to 1,500 free chips between hands if your stack is below 1,500

## Start it on your own computer

Requires **Node.js 20 or newer**.

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser. Create a room. Open a second private/incognito browser window or use another device on the same network (using your computer's local IP and port 3000) to test multiplayer. Separate browsers/devices keep their own player sessions.

To run the tests:

```bash
npm test
```

## Host free on Render

1. Extract this ZIP.
2. Make a new GitHub repository and upload **the contents of the `felt-friends-poker` folder** to the root of that repository. Do not upload only the ZIP file. Do not upload `node_modules`.
3. Sign into [Render](https://render.com), choose **New → Web Service**, and connect your GitHub repository.
4. Choose **Free** for the instance type.
5. Set **Build Command** to `npm install` and **Start Command** to `npm start`. Node is the runtime. The repository also contains a ready-to-use `render.yaml` Blueprint if you'd rather deploy that way.
6. Click **Deploy Web Service**. Render provides a public HTTPS address ending in `.onrender.com`.
7. Open that address, create a private table, and click **Copy invite link**. Send the link to your friends.

A Node web service is required: **don't choose Static Site**. Both the website and the real-time multiplayer server run on the same port. You do not need UptimeRobot.

### Limits of free hosting

Render's free web services may sleep after about 15 minutes without inbound traffic and generally take about one minute to wake. They may also restart or redeploy at any time. **This version keeps rooms, hands, and chip stacks in server memory**, so restarting or sleeping the service *resets all tables*. Refreshing a page while the server remains running is fine; your seat reconnects.

Free-service usage and bandwidth limits may change; see [Render's current free-tier documentation](https://render.com/docs/free).

If you later want chip stacks and games to survive server restarts, the next step is to add an external database or persistent key-value store.

## Rules and conventions

- 2–8 people per room; 1,500 starting free chips per person
- Fixed 10-chip small blind and 20-chip big blind
- Only connected players with chips are dealt into each new hand
- Others who join midway sit out until the next hand
- The host (or first connected player if host disconnects) starts each hand
- Short all-in raises do not reopen betting for players who already acted
- Folded hands remain private even after the showdown
- Chat is available to anyone seated at the table
- To protect the table, **the server** owns the deck, validates every action, and only sends private cards to the appropriate player

## Project structure

```text
felt-friends-poker/
├── server.js          Socket.IO server, private rooms, timers and chat
├── poker.js           Poker rules, dealing, hand rankings, side pots
├── public/
│   ├── index.html     Browser UI
│   ├── styles.css     Desktop/mobile table design
│   └── app.js         Client actions and real-time rendering
├── tests/
│   ├── poker.test.js
│   └── server.mock.test.js
├── render.yaml        Free Render configuration
└── package.json
```

## Not included yet

There's no account system, persistent scoreboard, tournament mode, spectator account, anti-collusion protection, or real-money mechanism. Rooms are private by unguessable invite code, **not password protected**; anyone you share a code with can join until the room fills up.

This is a hobby game intended for friends and **play chips only**.
