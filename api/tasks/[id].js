const { ObjectId } = require("mongodb");
const { getDb, setCors } = require("../_db");

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

  const { id } = req.query;
  let _id;
  try {
    _id = new ObjectId(id);
  } catch {
    return res.status(400).json({ error: "Invalid task id." });
  }

  try {
    const db = await getDb();
    const tasks = db.collection("tasks");

    if (req.method === "PATCH") {
      const body = req.body || {};
      const update = {};
      if (typeof body.done === "boolean") update.done = body.done;
      if (typeof body.text === "string" && body.text.trim()) update.text = body.text.trim().slice(0, 120);
      if (["low", "medium", "high"].includes(body.priority)) update.priority = body.priority;
      if (typeof body.due === "string") update.due = body.due.slice(0, 10);

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: "Nothing to update." });
      }
      const result = await tasks.findOneAndUpdate({ _id }, { $set: update }, { returnDocument: "after" });
      if (!result) return res.status(404).json({ error: "Task not found." });
      return res.status(200).json({ task: toClient(result) });
    }

    if (req.method === "DELETE") {
      const result = await tasks.deleteOne({ _id });
      if (result.deletedCount === 0) return res.status(404).json({ error: "Task not found." });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
};
