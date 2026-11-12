const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, GatewayIntentBits } = require('discord.js');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Environment & Server Configuration
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || '13th_hid_secure_secret_key';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback';
const BOT_TOKEN = process.env.BOT_TOKEN;

// Validate essential credentials on startup
if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !BOT_TOKEN) {
    console.error("FATAL: Missing required Discord environment variables (CLIENT_ID, CLIENT_SECRET, or BOT_TOKEN).");
    process.exit(1);
}

// 2. Session & Passport Authentication Setup
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(obj, done));

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// OAuth2 Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => { res.redirect('/'); }
);

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, user: req.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Serve static frontend assets from the "public" folder
app.use(express.static('public'));

// 3. Discord Bot Client Setup (Multi-Channel Capable)
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Listen for messages across ALL accessible channels on your Discord server
discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild || !message.channel.isTextBased()) return;
    
    // Broadcast the incoming Discord message and channel info to all connected website clients
    io.emit('chat-message', {
        channelId: message.channel.id,
        channelName: message.channel.name,
        user: message.author.username,
        avatar: message.author.displayAvatarURL(),
        text: message.content,
        source: 'discord'
    });
});

// 4. WebSocket Real-Time Bridge Handling
io.on('connection', (socket) => {
    console.log('A user connected to the website chat bridge.');

    // When a web user sends a message, route it to the specific Discord channel ID
    socket.on('chat-message', async (data) => {
        // data expects: { channelId, user, avatar, text }
        try {
            const channel = await discordClient.channels.fetch(data.channelId);
            if (channel && channel.isTextBased()) {
                await channel.send(`**[Web] ${data.user}:** ${data.text}`);
            }
        } catch (error) {
            console.error(`Failed to post web message to Discord channel ${data.channelId}:`, error);
        }

        // Broadcast the message back to other website clients viewing that same channel
        socket.broadcast.emit('chat-message', data);
    });
});

// Log in the Discord bot and start the web server
discordClient.login(BOT_TOKEN);

server.listen(PORT, () => {
    console.log(`13th HID Chat Bridge server running on port ${PORT}`);
});