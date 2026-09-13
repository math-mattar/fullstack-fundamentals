const express = require("express");
const server = require("http").createServer();
const app = express();

app.get("/", function (req, res) {
  res.sendFile("index.html", { root: __dirname });
});

server.on("request", app);

server.listen(3000, function () {
  console.log(`Server started on port 3000`);
});

// Websocket
const WebSocketServer = require("ws").Server;

const wss = new WebSocketServer({ server });

// Registrar um handler de SIGINT substitui o comportamento padrao do Node
// (sair na hora). A partir daqui o processo so termina quando o event loop
// esvaziar ou quando process.exit() for chamado explicitamente.
let shuttingDown = false;

process.on("SIGINT", () => {
  // O usuario pode apertar Ctrl+C varias vezes. Sem esse guard o handler roda
  // uma vez por sinal e shutdownDB() tenta fechar um handle ja fechado,
  // disparando SQLITE_MISUSE. O segundo Ctrl+C agora forca a saida.
  if (shuttingDown) {
    console.log("Forcando saida...");
    process.exit(1);
  }

  shuttingDown = true;

  console.log("Encerrando...");

  // client.close() inicia o closing handshake do WebSocket: envia o frame de
  // close e espera a resposta do cliente. terminate() destroi o socket na
  // hora, que e o que queremos num shutdown.
  wss.clients.forEach(function each(client) {
    client.terminate();
  });

  // Para de aceitar novos upgrades de WebSocket.
  wss.close();

  // server.close() nao derruba conexoes: apenas para de aceitar novas e espera
  // as existentes terminarem. Sockets keep-alive do browser podem segurar esse
  // callback por um bom tempo.
  server.close(() => {
    shutdownDB(() => process.exit(0));
  });

  // Rede de seguranca: se alguma conexao travar, sai a forca. O unref() evita
  // que esse proprio timer segure o event loop vivo por 5s a mais.
  setTimeout(() => {
    console.log("Timeout no shutdown, saindo a forca.");
    process.exit(1);
  }, 5000).unref();
});

wss.on("connection", function connection(ws) {
  const numClients = wss.clients.size;

  console.log("Clients connected:", numClients);

  wss.broadcast(`Current visitors: ${numClients}`);

  if (ws.readyState === ws.OPEN) {
    ws.send("Welcome to my server!");
  }

  db.run(`INSERT INTO visitors (count, time)
    VALUES (${numClients}, datetime('now'))`);

  ws.on("close", function close() {
    wss.broadcast(`Current visitors: ${wss.clients.size}`);

    console.log("A client has disconnected.");
  });
});

/**
 * Broadcast data to all connected clients
 * @param  {Object} data
 * @void
 */
wss.broadcast = function broadcast(data) {
  console.log("Broadcasting: ", data);

  wss.clients.forEach(function each(client) {
    // Um cliente em CLOSING/CLOSED faz send() lancar excecao, entao checamos o
    // readyState antes de escrever.
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  });
};
// End Websocket

// DB
const sqlite = require("sqlite3");

const db = new sqlite.Database(":memory:");

// Database e um EventEmitter: sem um listener de "error" qualquer erro do
// sqlite vira uncaught exception e derruba o processo.
db.on("error", (err) => {
  console.error("Erro no sqlite:", err);
});

db.serialize(() => {
  db.run(`
  CREATE TABLE visitors (
    count INTEGER,
    time TEXT
    )
  `);
});

function getCount(callback) {
  db.each(
    "SELECT * FROM visitors",
    (err, row) => {
      if (err) {
        return console.error(err);
      }

      console.log(row);
    },
    callback
  );
}

function shutdownDB(done) {
  console.log("Shutting down db");

  // db.each e assincrono: ele apenas enfileira a query. Chamar db.close()
  // logo depois fecha o handle antes das linhas serem lidas.
  // O terceiro argumento de db.each e o callback de conclusao, chamado depois
  // da ultima linha. Fechar o handle dentro dele garante que todas as linhas
  // foram impressas antes do close.
  getCount(() => {
    db.close((err) => {
      if (err) {
        console.error(err);
      }

      done();
    });
  });
}
