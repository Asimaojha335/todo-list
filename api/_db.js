const { MongoClient } = require("mongodb");

// Vercel serverless functions can be reused between invocations (same warm
// container), so cache the client on the global object to avoid opening a
// new MongoDB connection on every request.
let cachedClient = global._mongoClientTodo;

async function getDb() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    global._mongoClientTodo = cachedClient;
  }
  if (!cachedClient.topology || !cachedClient.topology.isConnected()) {
    await cachedClient.connect();
  }
  return cachedClient.db("todo_app");
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = { getDb, setCors };
