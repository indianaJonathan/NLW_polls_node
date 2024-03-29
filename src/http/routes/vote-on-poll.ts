import z from "zod";
import { prisma } from "../../lib/prisma";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { redis } from "../../lib/redis";
import { voting } from "../../utils/voting-pub-sub";

export async function voteOnPoll(app: FastifyInstance) {
  app.post('/polls/:pollId/votes', async (request, reply) => {
    // Get route params
    const voteOnPollParams = z.object({
      pollId: z.string().uuid(),
    });

    const { pollId } = voteOnPollParams.parse(request.params);

    // Get route body
    const voteOnPollBody = z.object({
      pollOptionId: z.string().uuid(),
    });

    const { pollOptionId } = voteOnPollBody.parse(request.body);

    // Generate session cookie
    let { sessionId } = request.cookies;

    if (sessionId) {
      const userPrevVotedOnPoll = await prisma.vote.findUnique({
        where: {
          sessionId_pollId: {
            sessionId,
            pollId
          }
        }
      });
      if (userPrevVotedOnPoll && userPrevVotedOnPoll.pollOptionId !== pollOptionId) {
        await prisma.vote.delete({
          where: {
            id: userPrevVotedOnPoll.id
          }
        });

        const votes = await redis.zincrby(pollId, -1, userPrevVotedOnPoll.pollOptionId);

        voting.publish(pollId, {
          pollOptionId: userPrevVotedOnPoll.pollOptionId, 
          votes: Number(votes),
        });

      } else if (userPrevVotedOnPoll) {
        return reply.status(400).send({ message: "You've already voted on this poll" });
      }
    }

    if (!sessionId) {
      sessionId = randomUUID();

      reply.setCookie("sessionId", sessionId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        signed: true,
        httpOnly: true,
      });
    }

    await prisma.vote.create({
      data: {
        sessionId,
        pollId,
        pollOptionId,
      }
    });

    const votes = await redis.zincrby(pollId, 1, pollOptionId);

    voting.publish(pollId, {
      pollOptionId, 
      votes: Number(votes),
    });

    return reply.status(201).send();
  });
}