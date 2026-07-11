import { redirect } from "next/navigation";

export default async function PromptExpertIndex(
  ctx: { params: Promise<{ subAccountId: string }> },
) {
  const { subAccountId } = await ctx.params;
  redirect(`/sa/${subAccountId}/promptexpert/prompts`);
}
