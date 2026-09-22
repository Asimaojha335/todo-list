const { getDb, setCors } = require("../_db");

// Turn a MongoDB document into the plain shape the front end expects.
function toClient(doc) {
  return {
    id: doc._id.toString(),
    text: doc.text,
    done: Boolean(doc.done),
    priority: doc.priority,
    due: doc.due || "",
    createdAt: doc.createdAt,
  };
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const db = await getDb();
    const tasks = db.collection("tasks");

    if (req.method === "GET") {
      const docs = await tasks.find({}).sort({ createdAt: -1 }).limit(500).toArray();
      return res.status(200).json({ tasks: docs.map(toClient) });
    }

    if (req.method === "POST") {
      const { text, priority, due } = req.body || {};
      const clean = String(text || "").trim().slice(0, 120);
      if (!clean) return res.status(400).json({ error: "Task text is required." });

      const allowedPriority = ["low", "medium", "high"].includes(priority) ? priority : "medium";
      const doc = {
        text: clean,
        done: false,
        priority: allowedPriority,
        due: typeof due === "string" ? due.slice(0, 10) : "",
        createdAt: new Date().toISOString(),
      };
      const result = await tasks.insertOne(doc);
      return res.status(201).json({ task: toClient({ ...doc, _id: result.insertedId }) });
    }

    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
};
