const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
require('dotenv').config();
// Bot Setup
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const lobbies = new Map();

let lobbyCountSinceUpdate = 0;

// Zufällige Themen
const topics = [
  "You're childhood",
  "Food & Drinks",
  "Travel & Places",
  "Relationships",
  "Movies & TV Shows",
  "Music & Entertainment",
  "Books & Literature",
  "Sports & Hobbies",
  "Life Lessons",
  "Embarrassing Moments",
  "Dreams & Aspirations",
  "Animals"
];

// Hilfsfunktionen
function generateLobbyCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getRandomTopic() {
  return topics[Math.floor(Math.random() * topics.length)];
}

// Slash Commands registrieren
const commands = [
  new SlashCommandBuilder()
    .setName('create-lobby')
    .setDescription('Create a new lobby'),

  new SlashCommandBuilder()
    .setName('join-lobby')
    .setDescription('Join a lobby')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('Lobby-Code')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('start-round')
    .setDescription('Start the next round (only for host)'),

  new SlashCommandBuilder()
    .setName('lobby-status')
    .setDescription('Show current lobby status'),

  new SlashCommandBuilder()
    .setName('end-game')
    .setDescription('End the current game (only for host)'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show bot statistics since last update'),

];

// Bot Events
client.once('ready', async () => {
  console.log(`Bot ist online als ${client.user.tag}`);

  // Commands registrieren
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const GUILD_ID = null; // Für Entwicklung: Deine Test-Guild ID

  try {
    if (GUILD_ID) {
      // Guild-spezifische Commands (sofort verfügbar)
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, GUILD_ID),
        { body: commands }
      );
      console.log(`Slash Commands erfolgreich in Guild ${GUILD_ID} registriert`);
    } else {
      // Globale Commands (bis zu 1h Wartezeit)
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      console.log('Globale Slash Commands registriert (kann bis zu 1h dauern)');
    }
  } catch (error) {
    console.error('Fehler beim Registrieren der Commands:', error);
  }
});

// Slash Command Handler
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButton(interaction);
  }
});

async function handleSlashCommand(interaction) {
  const { commandName, user, guildId } = interaction;

  // Prüfen ob Command in Server verwendet wird
  if (interaction.guild) {
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('❌ Please use this command in DMs!')
      .setDescription('**This game has to be played in dms**\n\n Please use the commands there.');
    
    console.log(`Guild ${interaction.guild.name} tried to use command ${commandName} in server channel.`);

    return await interaction.reply({ embeds: [embed], ephemeral: true }).then(async () => {
      await interaction.user.send("⚠️ Currently, you can only create lobbies via **DM with the bot**, not in a server channel. Play here!");
    })
  }

  switch (commandName) {
    case 'create-lobby':
      await createLobby(interaction);
      break;

    case 'join-lobby':
      await joinLobby(interaction);
      break;

    case 'start-round':
      await startRound(interaction);
      break;

    case 'lobby-status':
      await showLobbyStatus(interaction);
      break;

    case 'stats':
      await showStats(interaction);
      break;

    case 'end-game':
      await endGame(interaction);
      break;
  }
}

async function createLobby(interaction) {
  const userId = interaction.user.id;
  const code = generateLobbyCode();

  // Prüfen ob Spieler bereits Host einer Lobby ist
  for (const [lobbyCode, lobby] of lobbies) {
    if (lobby.hostId === userId) {
      return await interaction.reply({
        content: '❌ You are already hosting a lobby! Please end the current game first.',
        ephemeral: true
      });
    }
  }

  const lobby = {
    code: code,
    hostId: userId,
    players: new Set([userId]),
    currentRound: 0,
    gameActive: false,
    currentStatement: null,
    currentAnswer: null,
    votes: new Map(),
    scores: new Map(),
    currentHost: userId, // Wer aktuell Aussage machen muss
    playersOrder: [userId] // Reihenfolge der Spieler
  };

  lobby.scores.set(userId, 0);
  lobbies.set(code, lobby);

  lobbyCountSinceUpdate++;

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('🎉 Created lobby successfully!')
    .setDescription(`**Lobby-Code:** \`${code}\`\n\nOther player can join using \`/join-lobby ${code}\`.\n\nUse \`/start-round\` to start the next round.`)
    .setFooter({ text: 'You are the host of this lobby' });

  await interaction.reply({ embeds: [embed], ephemeral: true });

  console.log(`Created lobby ${code}`);
}

async function joinLobby(interaction) {
  const code = interaction.options.getString('code').toUpperCase();
  const userId = interaction.user.id;
  const lobby = lobbies.get(code);

  if (!lobby) {
    return await interaction.reply({
      content: '❌ Lobby not found!',
      ephemeral: true
    });
  }

  if (lobby.players.has(userId)) {
    return await interaction.reply({
      content: '❌ You are already in this lobby!',
      ephemeral: true
    });
  }

  if (lobby.gameActive) {
    return await interaction.reply({
      content: '❌ The game is already running! You cannot join now.',
      ephemeral: true
    });
  }

  lobby.players.add(userId);
  lobby.scores.set(userId, 0);

  // Spieler zur Reihenfolge hinzufügen
  lobby.playersOrder.push(userId);

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('✅ Joined lobby!')
    .setDescription(`You joined lobby \`${code}\`.\n\n**Players in this lobby:** ${lobby.players.size}`)
    .setFooter({ text: 'Waiting for the host to start the game' });

  console.log(`Someone joined lobby ${code}`);

  await interaction.reply({ embeds: [embed], ephemeral: true });

  try {
    const hostUser = await client.users.fetch(lobby.hostId);
    await hostUser.send(`📢 **${interaction.user.username}** joined your lobby (**${code}**)!`);
  } catch (err) {
    console.warn(`Konnte Host nicht per DM benachrichtigen: ${err.message}`);
  }
}

async function startRound(interaction) {
  const userId = interaction.user.id;
  let userLobby = null;
  let lobbyCode = null;

  // Finde Lobby des Users
  for (const [code, lobby] of lobbies) {
    if (lobby.players.has(userId)) {
      userLobby = lobby;
      lobbyCode = code;
      break;
    }
  }

  if (!userLobby) {
    return await interaction.reply({
      content: '❌ You are not in a lobby!',
      ephemeral: true
    });
  }

  if (userLobby.hostId !== userId) {
    return await interaction.reply({
      content: '❌ Only the host can start the next round!',
      ephemeral: true
    });
  }

  if (userLobby.players.size < 2) {
    return await interaction.reply({
      content: '❌ At least two players are required to start the next round!',
      ephemeral: true
    });
  }

  // Nächster Spieler der eine Aussage machen muss
  userLobby.currentRound++;
  const currentPlayerIndex = (userLobby.currentRound - 1) % userLobby.playersOrder.length;
  userLobby.currentHost = userLobby.playersOrder[currentPlayerIndex];

  const topic = getRandomTopic();
  userLobby.gameActive = true;
  userLobby.votes.clear();

  const currentPlayer = await client.users.fetch(userLobby.currentHost);

  console.log(`Started round ${userLobby.currentRound} in lobby ${userLobby.code}`);

  const embed = new EmbedBuilder()
    .setColor('#ffff00')
    .setTitle(`🎯 Round ${userLobby.currentRound}`)
    .setDescription(`**Topic:** ${topic}\n\n**It's ${currentPlayer.displayName} turn!**\n\nA true or false statement on this topic will be broadcast....`)
    .setFooter({ text: "Wait for the current player's statement" });

  // Benachrichtigung an den aktuellen Spieler
  const playerEmbed = new EmbedBuilder()
    .setColor('#ffff00')
    .setTitle(`🎯 It's your turn! - Round ${userLobby.currentRound}`)
    .setDescription(`**Topic:** ${topic}\n\nMake a true or false statement about this topic:`)
    .setFooter({ text: 'Click on the buttons to mark your statement as true or false.' });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`statement_true_${lobbyCode}`)
        .setLabel('My statement is TRUE.')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`statement_false_${lobbyCode}`)
        .setLabel('My statement is FALSE.')
        .setStyle(ButtonStyle.Danger)
    );

  try {
    // Nachricht an den aktuellen Spieler
    await currentPlayer.send({ embeds: [playerEmbed], components: [row] });

    // Info an den Host
    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });

    // Info an alle anderen Spieler
    for (const playerId of userLobby.players) {
      if (playerId === userId || playerId === userLobby.currentHost) continue;

      try {
        const player = await client.users.fetch(playerId);
        await player.send({ embeds: [embed] });
      } catch (error) {
        console.log(`Could not send round start info to ${playerId}`);
      }
    }
  } catch (error) {
    await interaction.reply({
      content: `❌ Could not send message to <@${userLobby.currentHost}>!`,
      ephemeral: true
    });
  }
}

async function showStats(interaction) {
  console.log(`Issued stats command by ${interaction.user.tag}`);

  const uptimeMs = Date.now() - client.readyTimestamp;
  const uptime = new Date(uptimeMs).toISOString().substr(11, 8); // HH:MM:SS

  const ping = Math.abs(Math.round(Date.now() - interaction.createdTimestamp));

  const embed = new EmbedBuilder()
    .setColor('#00ffff')
    .setTitle('📊 Bot Statistics')
    .addFields(
      { name: '🎮 Lobbies created', value: `${lobbyCountSinceUpdate}`, inline: true },
      { name: '⏱ Uptime', value: uptime, inline: true },
      { name: '🏓 Ping', value: `${ping} ms`, inline: true }
    )
    .setFooter({ text: 'These statistics are from the last update to date.' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}


async function showLobbyStatus(interaction) {
  const userId = interaction.user.id;
  let userLobby = null;
  let lobbyCode = null;

  for (const [code, lobby] of lobbies) {
    if (lobby.players.has(userId)) {
      userLobby = lobby;
      lobbyCode = code;
      break;
    }
  }

  if (!userLobby) {
    return await interaction.reply({
      content: '❌ You are not in any lobby!',
      ephemeral: true
    });
  }

  const playerList = Array.from(userLobby.players).map(id =>
    `<@${id}>${id === userLobby.hostId ? ' (Host)' : ''} - ${userLobby.scores.get(id)} Points`
  ).join('\n');

  console.log(`Issued status for lobby ${lobbyCode} by ${interaction.user.tag}`);

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`📊 Lobby Status - ${lobbyCode}`)
    .addFields(
      { name: '👥 Player', value: playerList || 'No player', inline: false },
      { name: '🔄 Rounds', value: userLobby.currentRound.toString(), inline: true },
      { name: '🎮 Status', value: userLobby.gameActive ? 'Game in progress' : 'Ready', inline: true }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function endGame(interaction) {
  const userId = interaction.user.id;
  let userLobby = null;
  let lobbyCode = null;

  for (const [code, lobby] of lobbies) {
    if (lobby.players.has(userId)) {
      userLobby = lobby;
      lobbyCode = code;
      break;
    }
  }

  if (!userLobby) {
    return await interaction.reply({
      content: '❌ You are not in any lobby!',
      ephemeral: true
    });
  }

  if (userLobby.hostId !== userId) {
    return await interaction.reply({
      content: '❌ Only the host can end the game!',
      ephemeral: true
    });
  }

  console.log(`Ended game in lobby ${userLobby.code} after ${userLobby.currentRound} rounds`);

  // Finale Rangliste erstellen
  const sortedPlayers = Array.from(userLobby.scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map((entry, index) => `${index + 1}. <@${entry[0]}> - ${entry[1]} Points`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor('#ffd700')
    .setTitle('🏆 Game over - Final rankings')
    .setDescription(sortedPlayers || 'No points awarded')
    .addFields(
      { name: '📈 Statistics', value: `${userLobby.currentRound} rounds played\n${userLobby.players.size} participants`, inline: false }
    )
    .setFooter({ text: 'Thank you for playing!' });

  // Nachricht an alle Spieler
  for (const playerId of userLobby.players) {
    try {
      const player = await client.users.fetch(playerId);
      await player.send({ embeds: [embed] });
    } catch (error) {
      console.log(`Could not send final ranking to ${playerId}`);
    }
  }

  // Lobby löschen
  lobbies.delete(lobbyCode);

  await interaction.reply({
    content: '✅ Game over! Final rankings have been sent to all players.',
    ephemeral: true
  });
}

async function handleButton(interaction) {
  const [action, value, lobbyCode] = interaction.customId.split('_');
  const userId = interaction.user.id;
  const lobby = lobbies.get(lobbyCode);

  if (!lobby) {
    return await interaction.reply({
      content: '❌ Lobby not found!',
      ephemeral: true
    });
  }

  if (action === 'statement') {
    // Aktueller Spieler gibt Aussage ab
    if (lobby.currentHost !== userId) {
      return await interaction.reply({
        content: "❌ It's not your turn to have a statement!",
        ephemeral: true
      });
    }

    const isTrue = value === 'true';

    const modal = {
      title: 'Enter your statement',
      custom_id: `modal_statement_${isTrue}_${lobbyCode}`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'statement_text',
              label: 'Your statement',
              style: 2,
              placeholder: 'Enter your true or false statement here...',
              required: true,
              max_length: 500
            }
          ]
        }
      ]
    };

    await interaction.showModal(modal);

  } else if (action === 'vote') {
    // Spieler stimmt ab
    if (lobby.currentHost === userId) {
      return await interaction.reply({
        content: '❌ You cannot vote on your own statement!',
        ephemeral: true
      });
    }

    if (lobby.votes.has(userId)) {
      return await interaction.reply({
        content: '❌ You have already voted!',
        ephemeral: true
      });
    }

    const vote = value === 'true';
    lobby.votes.set(userId, vote);

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('✅ Vote cast!')
      .setDescription(`You voted for “${vote ? 'TRUE' : 'FALSE'}”.\n\nWait for the other players...`)
      .setFooter({ text: `${lobby.votes.size}/${lobby.players.size - 1} players have voted` });

    await interaction.update({ embeds: [embed], components: [] });

    // Prüfen ob alle abgestimmt haben
    if (lobby.votes.size === lobby.players.size - 1) {
      await revealResults(lobby, lobbyCode);
    }
  } else if (action === 'next') {
    // Host startet nächste Runde
    if (lobby.hostId !== userId) {
      return await interaction.reply({
        content: '❌ Only the host can start the next round!',
        ephemeral: true
      });
    }

    if (lobby.gameActive) {
      return await interaction.reply({
        content: '❌ A round is already underway!',
        ephemeral: true
      });
    }

    // Nächster Spieler der eine Aussage machen muss
    lobby.currentRound++;
    const currentPlayerIndex = (lobby.currentRound - 1) % lobby.playersOrder.length;
    lobby.currentHost = lobby.playersOrder[currentPlayerIndex];

    const topic = getRandomTopic();
    lobby.gameActive = true;
    lobby.votes.clear();

    const currentPlayer = await client.users.fetch(lobby.currentHost);

    console.log(`Started round ${lobby.currentRound} in lobby ${lobbyCode}`);

    const embed = new EmbedBuilder()
      .setColor('#ffff00')
      .setTitle(`🎯 Round ${lobby.currentRound}`)
      .setDescription(`**Topic:** ${topic}\n\n**${currentPlayer.displayName} is up!**\n\nA true or false statement about this topic will be sent...`)
      .setFooter({ text: "Wait for the current player's statement" });

    // Benachrichtigung an den aktuellen Spieler
    const playerEmbed = new EmbedBuilder()
      .setColor('#ffff00')
      .setTitle(`🎯 It's your turn! - Round ${lobby.currentRound}`)
      .setDescription(`**Topic:** ${topic}\n\nMake a true or false statement about this topic:`)
      .setFooter({ text: 'Click on the buttons to mark your statement as true or false.' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`statement_true_${lobbyCode}`)
          .setLabel('My statement is TRUE.')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`statement_false_${lobbyCode}`)
          .setLabel('My statement is FALSE.')
          .setStyle(ButtonStyle.Danger)
      );

    try {
      // Nachricht an den aktuellen Spieler
      await currentPlayer.send({ embeds: [playerEmbed], components: [row] });

      // Alte Nachricht updaten
      await interaction.update({
        embeds: [embed],
        components: []
      });

      // Info an alle anderen Spieler
      for (const playerId of lobby.players) {
        if (playerId === userId || playerId === lobby.currentHost) continue;

        try {
          const player = await client.users.fetch(playerId);
          await player.send({ embeds: [embed] });
        } catch (error) {
          console.log(`Could not send round start info to ${playerId}`);
        }
      }
    } catch (error) {
      await interaction.followUp({
        content: `❌ Could not send message to <@${lobby.currentHost}>!`,
        ephemeral: true
      });
    }
  } else if (action === 'end' && value === 'game') {
    // Host beendet das Spiel
    if (lobby.hostId !== userId) {
      return await interaction.reply({
        content: '❌ Only the host can end the game!',
        ephemeral: true
      });
    }

    console.log(`Ended game in lobby ${lobbyCode} after ${lobby.currentRound} rounds`);

    // Finale Rangliste erstellen
    const sortedPlayers = Array.from(lobby.scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map((entry, index) => `${index + 1}. <@${entry[0]}> - ${entry[1]} Points`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('🏆 Game over - Final rankings')
      .setDescription(sortedPlayers || 'No points awarded')
      .addFields(
        { name: '📈 Statistics', value: `${lobby.currentRound} rounds played\n${lobby.players.size} participants`, inline: false }
      )
      .setFooter({ text: 'Thank you for playing' });

    // Nachricht an alle Spieler
    for (const playerId of lobby.players) {
      if (playerId != lobby.hostId) {
        try {
          const player = await client.users.fetch(playerId);
          await player.send({ embeds: [embed] });
        } catch (error) {
          console.log(`Could not send final ranking to ${playerId}`);
        }
      }
    }

    // Lobby löschen
    lobbies.delete(lobbyCode);

    await interaction.update({
      embeds: [embed],
      components: []
    });
  }
}

// Modal Submit Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;

  const [modal, statement, isTrue, lobbyCode] = interaction.customId.split('_');

  if (modal === 'modal' && statement === 'statement') {
    const lobby = lobbies.get(lobbyCode);
    const statementText = interaction.fields.getTextInputValue('statement_text');

    lobby.currentStatement = statementText;
    lobby.currentAnswer = isTrue === 'true';

    await interaction.reply({
      content: `✅ Statement saved and sent to all players!`,
      ephemeral: true
    });

    // Aussage an alle anderen Spieler senden
    const embed = new EmbedBuilder()
      .setColor('#ffff00')
      .setTitle(`🤔 Round ${lobby.currentRound} - Voting`)
      .setDescription(`**Statement from <@${lobby.currentHost}>:**\n“${statementText}”\n\n**Is this statement true or false?**`)
      .setFooter({ text: 'Cast your vote secretly!' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`vote_true_${lobbyCode}`)
          .setLabel('TRUE')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`vote_false_${lobbyCode}`)
          .setLabel('FALSE')
          .setStyle(ButtonStyle.Danger)
      );

    for (const playerId of lobby.players) {
      if (playerId === lobby.currentHost) continue;

      try {
        const player = await client.users.fetch(playerId);
        await player.send({
          embeds: [embed],
          components: [row]
        });
      } catch (error) {
        console.log(`Could not send message to ${playerId}`);
      }
    }
  }
});

async function revealResults(lobby, lobbyCode) {
  const correctAnswer = lobby.currentAnswer;
  const correctVoters = [];
  const wrongVoters = [];

  for (const [playerId, vote] of lobby.votes) {
    if (vote === correctAnswer) {
      correctVoters.push(playerId);
      lobby.scores.set(playerId, lobby.scores.get(playerId) + 1);
    } else {
      wrongVoters.push(playerId);
    }
  }

  const resultEmbed = new EmbedBuilder()
    .setColor(correctAnswer ? '#00ff00' : '#ff0000')
    .setTitle('📊 Round result')
    .setDescription(`**The statement was: ${correctAnswer ? 'TRUE' : 'FALSE'}**\n\n“${lobby.currentStatement}”\n\n*From <@${lobby.currentHost}>*`)
    .addFields(
      {
        name: '✅ Guessed right (+1 Punkt)',
        value: correctVoters.map(id => `<@${id}>`).join('\n') || 'None',
        inline: true
      },
      {
        name: '❌ Guessed wrong',
        value: wrongVoters.map(id => `<@${id}>`).join('\n') || 'None',
        inline: true
      }
    )
    .setFooter({ text: `Round ${lobby.currentRound} finished` });

  // Aktueller Punktestand
  const scoreList = Array.from(lobby.scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(entry => `<@${entry[0]}>: ${entry[1]} Points`)
    .join('\n');

  const scoreEmbed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🏆 Current score')
    .setDescription(scoreList)
    .setFooter({ text: 'Wait for the next round...' });

  // Button für Host um nächste Runde zu starten
  const nextRoundButton = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`next_round_${lobbyCode}`)
        .setLabel('🎯 Start next round')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`end_game_${lobbyCode}`)
        .setLabel('🏁 End game')
        .setStyle(ButtonStyle.Danger)
    );

  // Ergebnisse an alle Spieler senden
  for (const playerId of lobby.players) {
    try {
      const player = await client.users.fetch(playerId);

      if (playerId === lobby.hostId) {
        // Host bekommt zusätzlich die Buttons
        await player.send({
          embeds: [resultEmbed, scoreEmbed],
          components: [nextRoundButton]
        });
      } else {
        // Andere Spieler bekommen nur die Ergebnisse
        await player.send({ embeds: [resultEmbed, scoreEmbed] });
      }
    } catch (error) {
      console.log(`Could not send result to ${playerId}`);
    }
  }

  // Lobby zurücksetzen für nächste Runde
  lobby.currentStatement = null;
  lobby.currentAnswer = null;
  lobby.votes.clear();
  lobby.gameActive = false;
}

// Error Handling
client.on('error', console.error);

client.login(process.env.DISCORD_TOKEN);