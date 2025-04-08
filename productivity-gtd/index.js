// GTD Discord Bot - Productivity Assistant with Logging
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
require('dotenv').config()

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Data storage paths
const DATA_DIR = path.join(__dirname, "data");
const LOG_DIR = path.join(__dirname, "logs");

// Create necessary directories
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

// Logging function
const logEvent = (userId, eventType, details) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    userId,
    eventType,
    details,
  };

  const logFile = path.join(LOG_DIR, `${userId}_log.json`);

  // Read existing logs or create new log array
  let logs = [];
  if (fs.existsSync(logFile)) {
    try {
      logs = JSON.parse(fs.readFileSync(logFile));
    } catch (e) {
      console.error("Error reading log file:", e);
    }
  }

  // Add new log entry
  logs.push(logEntry);

  // Write updated logs
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));

  // Also output to console for server monitoring
  console.log(
    `[${timestamp}] USER:${userId} EVENT:${eventType} - ${JSON.stringify(
      details
    )}`
  );

  return logEntry;
};

// Task database structure
const getUserDataPath = (userId) => path.join(DATA_DIR, `${userId}.json`);

const getTasksForUser = (userId) => {
  const dataPath = getUserDataPath(userId);
  if (fs.existsSync(dataPath)) {
    return JSON.parse(fs.readFileSync(dataPath));
  }
  return {
    inbox: [], // Uncategorized tasks
    projects: {}, // Project-based tasks
    contexts: {}, // Context-based tasks (@home, @work, etc)
    nextActions: [], // Tasks ready to be done
    waiting: [], // Tasks waiting on others
    someday: [], // Future tasks
    completed: [], // Finished tasks
  };
};

const saveTasksForUser = (userId, tasks) => {
  const dataPath = getUserDataPath(userId);
  fs.writeFileSync(dataPath, JSON.stringify(tasks, null, 2));
};

// Command handling
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const prefix = "!gtd";
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Load user tasks
  const userId = message.author.id;
  const userTasks = getTasksForUser(userId);

  try {
    switch (command) {
      case "capture":
      case "add":
        // Capture a new task into inbox
        const taskContent = args.join(" ");
        if (!taskContent)
          return message.reply("Please provide a task description.");

        const newTask = {
          id: Date.now(),
          content: taskContent,
          created: new Date().toISOString(),
          status: "inbox",
        };

        userTasks.inbox.push(newTask);
        saveTasksForUser(userId, userTasks);

        // Log the event
        logEvent(userId, "TASK_CAPTURED", {
          taskId: newTask.id,
          content: taskContent,
        });

        message.reply(`✅ Task captured: "${taskContent}"`);
        break;

      case "inbox":
        // Show tasks in inbox
        logEvent(userId, "INBOX_VIEWED", {
          count: userTasks.inbox.length,
        });

        if (userTasks.inbox.length === 0) {
          return message.reply(
            "Your inbox is empty. Great job processing everything!"
          );
        }

        const inboxEmbed = new EmbedBuilder()
          .setTitle("📥 Inbox")
          .setColor("#0099ff")
          .setDescription("Tasks waiting to be processed:")
          .addFields(
            userTasks.inbox.map((task, index) => {
              return { name: `#${index + 1}`, value: task.content };
            })
          );

        message.reply({ embeds: [inboxEmbed] });
        break;

      case "process":
        // Process a task from inbox to appropriate list
        const inboxIndex = parseInt(args[0]) - 1;
        const destination = args[1]; // nextaction, project, waiting, someday
        const additionalInfo = args.slice(2).join(" ");

        if (
          isNaN(inboxIndex) ||
          inboxIndex < 0 ||
          inboxIndex >= userTasks.inbox.length
        ) {
          return message.reply("Please provide a valid inbox task number.");
        }

        if (
          !["nextaction", "project", "waiting", "someday", "done"].includes(
            destination
          )
        ) {
          return message.reply(
            "Please specify where to move this task: nextaction, project, waiting, someday, or done"
          );
        }

        const taskToProcess = userTasks.inbox[inboxIndex];

        // Log processing attempt
        logEvent(userId, "TASK_PROCESSING", {
          taskId: taskToProcess.id,
          content: taskToProcess.content,
          destination: destination,
          additionalInfo: additionalInfo,
        });

        // Remove from inbox
        userTasks.inbox.splice(inboxIndex, 1);

        // Add to appropriate list
        switch (destination) {
          case "nextaction":
            taskToProcess.status = "next";
            userTasks.nextActions.push(taskToProcess);
            message.reply(
              `✅ Task moved to Next Actions: "${taskToProcess.content}"`
            );
            break;

          case "project":
            if (!additionalInfo) {
              return message.reply("Please specify a project name.");
            }
            if (!userTasks.projects[additionalInfo]) {
              userTasks.projects[additionalInfo] = [];
            }
            taskToProcess.status = "project";
            taskToProcess.project = additionalInfo;
            userTasks.projects[additionalInfo].push(taskToProcess);
            message.reply(
              `✅ Task added to project "${additionalInfo}": "${taskToProcess.content}"`
            );
            break;

          case "waiting":
            taskToProcess.status = "waiting";
            if (additionalInfo) {
              taskToProcess.waitingFor = additionalInfo;
            }
            userTasks.waiting.push(taskToProcess);
            message.reply(
              `✅ Task moved to Waiting: "${taskToProcess.content}"`
            );
            break;

          case "someday":
            taskToProcess.status = "someday";
            userTasks.someday.push(taskToProcess);
            message.reply(
              `✅ Task moved to Someday/Maybe: "${taskToProcess.content}"`
            );
            break;

          case "done":
            taskToProcess.status = "done";
            taskToProcess.completed = new Date().toISOString();
            userTasks.completed.push(taskToProcess);
            message.reply(`🎉 Task completed: "${taskToProcess.content}"`);
            break;
        }

        saveTasksForUser(userId, userTasks);

        // Log successful processing
        logEvent(userId, "TASK_PROCESSED", {
          taskId: taskToProcess.id,
          oldStatus: "inbox",
          newStatus: taskToProcess.status,
          destination: destination,
        });
        break;

      case "next":
        // Show next actions
        logEvent(userId, "NEXT_ACTIONS_VIEWED", {
          count: userTasks.nextActions.length,
        });

        if (userTasks.nextActions.length === 0) {
          return message.reply(
            "You have no next actions. Process some tasks from your inbox!"
          );
        }

        const nextEmbed = new EmbedBuilder()
          .setTitle("⚡ Next Actions")
          .setColor("#00ff00")
          .setDescription("Tasks you can do now:")
          .addFields(
            userTasks.nextActions.map((task, index) => {
              return { name: `#${index + 1}`, value: task.content };
            })
          );

        message.reply({ embeds: [nextEmbed] });
        break;

      case "projects":
        // List all projects
        const projectNames = Object.keys(userTasks.projects);

        logEvent(userId, "PROJECTS_VIEWED", {
          count: projectNames.length,
          projectNames: projectNames,
        });

        if (projectNames.length === 0) {
          return message.reply("You have no active projects.");
        }

        const projectsEmbed = new EmbedBuilder()
          .setTitle("📂 Projects")
          .setColor("#ff9900")
          .addFields(
            projectNames.map((name) => {
              const count = userTasks.projects[name].length;
              return {
                name: name,
                value: `${count} task${count !== 1 ? "s" : ""}`,
              };
            })
          );

        message.reply({ embeds: [projectsEmbed] });
        break;

      case "project":
        // View tasks in a specific project
        const projectName = args.join(" ");

        if (!projectName) {
          return message.reply("Please specify a project name.");
        }

        logEvent(userId, "PROJECT_VIEWED", {
          projectName: projectName,
          exists: Boolean(userTasks.projects[projectName]),
          taskCount: userTasks.projects[projectName]
            ? userTasks.projects[projectName].length
            : 0,
        });

        if (
          !userTasks.projects[projectName] ||
          userTasks.projects[projectName].length === 0
        ) {
          return message.reply(`No tasks found for project "${projectName}".`);
        }

        const projectEmbed = new EmbedBuilder()
          .setTitle(`Project: ${projectName}`)
          .setColor("#ff9900")
          .addFields(
            userTasks.projects[projectName].map((task, index) => {
              return { name: `#${index + 1}`, value: task.content };
            })
          );

        message.reply({ embeds: [projectEmbed] });
        break;

      case "waiting":
        // Show waiting tasks
        logEvent(userId, "WAITING_VIEWED", {
          count: userTasks.waiting.length,
        });

        if (userTasks.waiting.length === 0) {
          return message.reply("You have no tasks in the waiting list.");
        }

        const waitingEmbed = new EmbedBuilder()
          .setTitle("⏳ Waiting For")
          .setColor("#ff00ff")
          .addFields(
            userTasks.waiting.map((task, index) => {
              const waitingText = task.waitingFor
                ? ` (Waiting for: ${task.waitingFor})`
                : "";
              return {
                name: `#${index + 1}`,
                value: `${task.content}${waitingText}`,
              };
            })
          );

        message.reply({ embeds: [waitingEmbed] });
        break;

      case "someday":
        // Show someday/maybe tasks
        logEvent(userId, "SOMEDAY_VIEWED", {
          count: userTasks.someday.length,
        });

        if (userTasks.someday.length === 0) {
          return message.reply("You have no tasks in the Someday/Maybe list.");
        }

        const somedayEmbed = new EmbedBuilder()
          .setTitle("🔮 Someday/Maybe")
          .setColor("#9900ff")
          .addFields(
            userTasks.someday.map((task, index) => {
              return { name: `#${index + 1}`, value: task.content };
            })
          );

        message.reply({ embeds: [somedayEmbed] });
        break;

      case "done":
      case "completed":
        // Show recently completed tasks (last 10)
        const recentCompleted = userTasks.completed.slice(-10).reverse();

        logEvent(userId, "COMPLETED_VIEWED", {
          recentCount: recentCompleted.length,
          totalCount: userTasks.completed.length,
        });

        if (recentCompleted.length === 0) {
          return message.reply("You have no completed tasks yet.");
        }

        const doneEmbed = new EmbedBuilder()
          .setTitle("✅ Completed Tasks")
          .setColor("#666666")
          .addFields(
            recentCompleted.map((task, index) => {
              const completedDate = new Date(
                task.completed
              ).toLocaleDateString();
              return {
                name: `#${index + 1}`,
                value: `${task.content} (Completed: ${completedDate})`,
              };
            })
          );

        message.reply({ embeds: [doneEmbed] });
        break;

      case "weekly":
        // Start weekly review process
        logEvent(userId, "WEEKLY_REVIEW_STARTED", {
          inboxCount: userTasks.inbox.length,
          nextActionsCount: userTasks.nextActions.length,
          projectsCount: Object.keys(userTasks.projects).length,
          waitingCount: userTasks.waiting.length,
          somedayCount: userTasks.someday.length,
        });

        const weeklyEmbed = new EmbedBuilder()
          .setTitle("🔄 Weekly Review")
          .setColor("#0099ff")
          .setDescription("Follow these steps for your weekly review:")
          .addFields(
            {
              name: "1. Get Clear",
              value:
                "Collect loose papers & materials\nProcess all notes\nCheck !gtd inbox",
            },
            {
              name: "2. Get Current",
              value:
                "Review Next Actions lists\nReview Previous calendar data\nReview Upcoming calendar\nReview Waiting For list\nReview Project lists",
            },
            {
              name: "3. Get Creative",
              value: "Review Someday/Maybe list\nBe creative & courageous",
            }
          );

        message.reply({ embeds: [weeklyEmbed] });
        break;

      case "logs":
        // View recent log entries for the user
        const logFile = path.join(LOG_DIR, `${userId}_log.json`);
        let logs = [];

        if (fs.existsSync(logFile)) {
          logs = JSON.parse(fs.readFileSync(logFile));
        }

        // Get the most recent logs (last 10)
        const recentLogs = logs.slice(-10).reverse();

        if (recentLogs.length === 0) {
          return message.reply("No activity logs found.");
        }

        const logsEmbed = new EmbedBuilder()
          .setTitle("📊 Recent Activity")
          .setColor("#0099ff")
          .setDescription(
            `Your recent GTD activity (last ${recentLogs.length} events):`
          )
          .addFields(
            recentLogs.map((log, index) => {
              const date = new Date(log.timestamp).toLocaleString();
              let detailText = "";

              if (log.eventType === "TASK_CAPTURED") {
                detailText = `Added task: "${log.details.content}"`;
              } else if (log.eventType === "TASK_PROCESSED") {
                detailText = `Processed task from inbox to ${log.details.newStatus}`;
              } else if (log.eventType.includes("VIEWED")) {
                detailText = `Viewed ${log.eventType
                  .replace("_VIEWED", "")
                  .toLowerCase()}`;
              } else {
                detailText = log.eventType;
              }

              return {
                name: `${date}`,
                value: detailText,
              };
            })
          );

        message.reply({ embeds: [logsEmbed] });
        break;

      case "stats":
        // Show productivity statistics
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Get log data
        const statsLogFile = path.join(LOG_DIR, `${userId}_log.json`);
        let allLogs = [];

        if (fs.existsSync(statsLogFile)) {
          allLogs = JSON.parse(fs.readFileSync(statsLogFile));
        }

        // Filter logs from the past week
        const recentStats = allLogs.filter(
          (log) => new Date(log.timestamp) > oneWeekAgo
        );

        // Calculate statistics
        const tasksAdded = recentStats.filter(
          (log) => log.eventType === "TASK_CAPTURED"
        ).length;
        const tasksCompleted = recentStats.filter(
          (log) =>
            log.eventType === "TASK_PROCESSED" &&
            log.details.newStatus === "done"
        ).length;
        const inboxProcessed = recentStats.filter(
          (log) => log.eventType === "TASK_PROCESSED"
        ).length;

        logEvent(userId, "STATS_VIEWED", {
          period: "7days",
          tasksAdded,
          tasksCompleted,
          inboxProcessed,
        });

        const statsEmbed = new EmbedBuilder()
          .setTitle("📈 GTD Statistics (Last 7 Days)")
          .setColor("#0099ff")
          .addFields(
            {
              name: "Tasks Captured",
              value: tasksAdded.toString(),
              inline: true,
            },
            {
              name: "Tasks Completed",
              value: tasksCompleted.toString(),
              inline: true,
            },
            {
              name: "Inbox Items Processed",
              value: inboxProcessed.toString(),
              inline: true,
            },
            {
              name: "Current System Status",
              value: `Inbox: ${userTasks.inbox.length} items\nNext Actions: ${
                userTasks.nextActions.length
              } items\nProjects: ${
                Object.keys(userTasks.projects).length
              }\nWaiting For: ${userTasks.waiting.length} items`,
            }
          );

        message.reply({ embeds: [statsEmbed] });
        break;

      case "help":
        logEvent(userId, "HELP_VIEWED", {});

        const helpEmbed = new EmbedBuilder()
          .setTitle("GTD Bot - Help")
          .setColor("#0099ff")
          .setDescription("Getting Things Done productivity bot")
          .addFields(
            { name: "!gtd add [task]", value: "Capture a new task to inbox" },
            { name: "!gtd inbox", value: "View tasks in your inbox" },
            {
              name: "!gtd process [#] [destination] [info]",
              value:
                "Process inbox item to: nextaction, project, waiting, someday, or done",
            },
            { name: "!gtd next", value: "View your next actions" },
            { name: "!gtd projects", value: "List all your projects" },
            {
              name: "!gtd project [name]",
              value: "View tasks in a specific project",
            },
            { name: "!gtd waiting", value: "View tasks waiting on others" },
            { name: "!gtd someday", value: "View someday/maybe list" },
            { name: "!gtd done", value: "View recently completed tasks" },
            { name: "!gtd weekly", value: "Start weekly review process" },
            { name: "!gtd logs", value: "View your recent activity logs" },
            { name: "!gtd stats", value: "View your productivity statistics" }
          );

        message.reply({ embeds: [helpEmbed] });
        break;

      default:
        logEvent(userId, "UNKNOWN_COMMAND", {
          command: command,
          fullMessage: message.content,
        });

        message.reply(
          "Unknown command. Type `!gtd help` to see available commands."
        );
    }
  } catch (error) {
    console.error("Error executing command:", error);

    // Log the error
    logEvent(userId, "ERROR", {
      command: command,
      error: error.message,
      stack: error.stack,
    });

    message.reply("There was an error executing that command.");
  }
});

// Export logs function for analytics
const exportUserLogs = (userId, format = "json") => {
  const logFile = path.join(LOG_DIR, `${userId}_log.json`);

  if (!fs.existsSync(logFile)) {
    return null;
  }

  const logs = JSON.parse(fs.readFileSync(logFile));

  if (format === "csv") {
    // Convert to CSV
    const header = "timestamp,userId,eventType,details\n";
    const rows = logs
      .map((log) => {
        return `"${log.timestamp}","${log.userId}","${
          log.eventType
        }","${JSON.stringify(log.details).replace(/"/g, '""')}"`;
      })
      .join("\n");

    return header + rows;
  }

  return logs;
};

// Login to Discord
client.login(process.env.DISCORD_BOT_TOKEN);

// Set up periodic reminders for weekly review
const scheduleWeeklyReview = () => {
  // Find all users with data
  const userFiles = fs.readdirSync(DATA_DIR);

  userFiles.forEach((file) => {
    const userId = path.parse(file).name;
    // Logic to determine if user needs a weekly review reminder
    // This is simplified - you'd want to check last review date

    // For demo purposes, we'll just log this
    console.log(`Would send weekly review reminder to user ${userId}`);

    // Log that a reminder would be sent
    logEvent("SYSTEM", "WEEKLY_REMINDER_SCHEDULED", {
      targetUserId: userId,
    });

    // In a real implementation, you'd use:
    // client.users.fetch(userId).then(user => {
    //   user.send('Time for your weekly GTD review! Type `!gtd weekly` to start.');
    //   logEvent(userId, 'WEEKLY_REMINDER_SENT', {});
    // }).catch(console.error);
  });
};

// Check for reviews every day
setInterval(scheduleWeeklyReview, 24 * 60 * 60 * 1000);

// Bot ready event
client.once("ready", () => {
  console.log(`GTD Bot is ready! Logged in as ${client.user.tag}`);
  logEvent("SYSTEM", "BOT_STARTED", {
    botUsername: client.user.tag,
    startTime: new Date().toISOString(),
  });
});
