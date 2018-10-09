const Player = require('./Player');
const Card = require('./Card');

module.exports = class Game {
    constructor(client, channel) {
        this.client = client;
        this.channel = channel;
        this.players = {};
        this.queue = [];
        this.deck = [];
        this.discard = [];
        this.finished = [];
        this.started = false;
        this.confirm = false;
        this.lastChange = Date.now();
        this.drawn = 0;
        this.timeStarted = null;
        this.rules = {
            drawSkip: {
                desc: 'Whether pickup cards (+2, +4) should also skip the next person\'s turn.',
                value: true,
                name: 'Draws Skip'
            },
            initialCards: {
                desc: 'How many cards to pick up at the beginning.',
                value: 7,
                name: 'Initial Cards'
            },
            mustPlay: {
                desc: 'Whether someone must play a card if they are able to.',
                value: false,
                name: 'Must Play'
            }
        };
    }

    static deserialize(obj, client) {
        let channel = client.getChannel(obj.channel);
        let game = new Game(client, channel);
        for (const id in obj.players) {
            game.players[id] = Player.deserialize(obj.players[id], game);
        }
        game.queue = obj.queue.map(p => game.players[p]);
        game.deck = obj.deck.map(c => Card.deserialize(c));
        game.discard = obj.discard.map(c => Card.deserialize(c));
        game.finished = obj.finished.map(p => game.players[p]);
        game.started = obj.started;
        game.confirm = obj.confirm;
        game.lastChange = Date.now(); // set to current date to account for potential downtime
        game.rules = obj.rules;
        game.timeStarted = obj.timeStarted || (obj.started ? Date.now() : null);
        game.drawn = obj.drawn || 0;
        return game;
    }

    serialize() {
        let obj = {
            channel: this.channel.id,
            players: {},
            queue: this.queue.map(p => p.id),
            deck: this.deck.map(c => c.serialize()),
            discard: this.discard.map(c => c.serialize()),
            finished: this.finished.map(p => p.id),
            started: this.started,
            confirm: this.confirm,
            lastChange: Date.now(),
            rules: this.rules,
            timeStarted: this.timeStarted,
            drawn: this.drawn
        };
        for (const id in this.players) {
            obj.players[id] = this.players[id].serialize();
        }

        return obj;
    }

    get player() {
        return this.queue[0];
    }

    get flipped() {
        return this.discard[this.discard.length - 1];
    }

    async next() {
        this.queue.push(this.queue.shift());
        this.queue = this.queue.filter(p => !p.finished);
        this.player.sendHand(true);
        this.lastChange = Date.now();
    }

    async send(content) {
        await this.client.createMessage(this.channel.id, content);
    }

    addPlayer(member) {
        this.lastChange = Date.now();
        if (!this.players[member.id]) {
            let player = this.players[member.id] = new Player(member, this);
            this.queue.push(player);
            return player;
        }
        else return null;
    }

    async notifyPlayer(player, cards = player.hand) {
        try {
            await player.send('You were dealt the following card(s):\n' + cards.map(c => `**${c}**`).join(' | '));
        } catch (err) {
            await this.send(`Hey <@${player.id}>, I can't DM you! Please make sure your DMs are enabled, and run \`uno hand\` to see your cards.`);
        }
    }

    async dealAll(number, players = this.queue) {
        let cards = {};
        for (let i = 0; i < number; i++)
            for (const player of players) {
                if (this.deck.length === 0) {
                    if (this.discard.length === 1) break;
                    this.shuffleDeck();
                }
                let c = this.deck.pop();
                if (!cards[player.id]) cards[player.id] = [];
                cards[player.id].push(c.toString());
                player.hand.push(c);
                this.drawn++;
            }
        for (const player of players) {
            player.called = false;
            if (cards[player.id].length > 0)
                await this.notifyPlayer(player, cards[player.id]);

        }
    }

    async deal(player, number) {
        let cards = [];
        for (let i = 0; i < number; i++) {
            if (this.deck.length === 0) {
                if (this.discard.length === 1) break;
                this.shuffleDeck();
            }
            let c = this.deck.pop();
            cards.push(c.toString());
            player.hand.push(c);
            this.drawn++;
        }
        player.called = false;
        if (cards.length > 0)
            await this.notifyPlayer(player, cards);
    }

    generateDeck() {
        for (const color of ['R', 'Y', 'G', 'B']) {
            this.deck.push(new Card('0', color));
            for (let i = 1; i < 10; i++)
                for (let ii = 0; ii < 2; ii++)
                    this.deck.push(new Card(i.toString(), color));
            for (let i = 0; i < 2; i++)
                this.deck.push(new Card('SKIP', color));
            for (let i = 0; i < 2; i++)
                this.deck.push(new Card('REVERSE', color));
            for (let i = 0; i < 2; i++)
                this.deck.push(new Card('+2', color));
        }
        for (let i = 0; i < 4; i++) {
            this.deck.push(new Card('WILD'));
            this.deck.push(new Card('WILD+4'));
        }

        this.shuffleDeck();
    }

    shuffleDeck() {
        var j, x, i, a = [].concat(this.deck, this.discard);
        for (i = a.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            x = a[i];
            a[i] = a[j];
            a[j] = x;
        }
        this.deck = a;
        for (const card of this.deck.filter(c => c.wild))
            card.color = undefined;
        this.send('*Thfwwp!* The deck has been shuffled.');
    }
}