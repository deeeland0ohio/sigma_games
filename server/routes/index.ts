import { Router } from "express";
import contentLoaderRouter from "./contentLoader";
import chatRouter from "./chat";
import gamesRouter from "./games";
import aiRouter from "./ai";

const apiRouter = Router();

apiRouter.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

apiRouter.use(contentLoaderRouter);
apiRouter.use(chatRouter);
apiRouter.use(gamesRouter);
apiRouter.use(aiRouter);

export default apiRouter;
