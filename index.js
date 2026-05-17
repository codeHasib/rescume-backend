require("dotenv").config();

const express = require("express");
const cors = require("cors");
const app = express();
// Middlewares
app.use(cors());
app.use(express.json());
// SERVER-PORT
const SERVER_PORT = 5000;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASS}@cluster0.cmdrutm.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("rescume");
    const petsCollection = db.collection("pets");
    const adoptionList = db.collection("");

    app.get("/pets", async (req, res) => {
      const cursor = petsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/pets", async (req, res) => {
      const newPet = req.body;
      const result = await petsCollection.insertOne(newPet);
      res.send(result);
    });

    app.delete("/pets/:id", async (req, res) => {
      const query = {
        _id: new ObjectId(req.params.id),
      };
      const result = await petsCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/pets/:id", async (req, res) => {
      const query = {
        _id: new ObjectId(req.params.id),
      };
      const updatedPet = req.body;
      const result = await petsCollection.updateOne(query, {
        $set: updatedPet,
      });
      res.send(result);
    });
    
  } finally {
  }
}
run().catch(console.dir);

app.listen(SERVER_PORT, console.log(`${SERVER_PORT} is listening on port`));
