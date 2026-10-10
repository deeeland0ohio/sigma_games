import express from "express";
import compression from "compression";
import apiRouter from "../server/routes/index";

const app = express();
app.use(compression());
app.use(express.json());
app.use("/api", apiRouter);

export default app;
