export const SUPPORTED_MILESTONES = [1, 25, 50, 75, 100, 250, 500, 750, 1000] as const;

export type Milestone = (typeof SUPPORTED_MILESTONES)[number];

export const isSupportedMilestone = (value: number): value is Milestone =>
  SUPPORTED_MILESTONES.includes(value as Milestone);

export const getMilestoneMessage = (milestone: Milestone, lockName: string, scanCount: number) => {
  switch (milestone) {
    case 1:
      return {
        title: 'Your first scan! 🥳',
        body: `Someone just unlocked ${lockName} for the very first time — the story officially begins!`,
      };
    case 25:
      return {
        title: `${scanCount} scans! The word's getting out 👀`,
        body: `${lockName} is starting to get noticed! ${scanCount} curious hearts have stopped by to take a look.`,
      };
    case 50:
      return {
        title: `${scanCount} scans — that's a crowd! 🎉`,
        body: 'Fifty people have peeked into your memories. You might be the next local legend at this rate.',
      };
    case 75:
      return {
        title: `${scanCount} scans and still growing 🌱`,
        body: `${lockName} becoming a regular stop for lovebirds and memory hunters alike.`,
      };
    case 100:
      return {
        title: '💯 scans! Certified Memory Lock classic',
        body: `You've hit ${scanCount} scans! That's a hundred people who've relived a little piece of your story.`,
      };
    case 250:
      return {
        title: `${scanCount} scans?! You're officially famous 📸`,
        body: `${lockName} turning heads — that's a quarter-thousand people who've stopped by to feel something.`,
      };
    case 500:
      return {
        title: `${scanCount} scans — Memory Lock superstar 🌟`,
        body: `Half a thousand visits! ${lockName} is practically an attraction now. Time for a victory selfie?`,
      };
    case 750:
      return {
        title: `${scanCount} scans! Almost a legend 🔥`,
        body: "You're only a few scans away from hitting the 1000 club. People clearly love your story.",
      };
    case 1000:
      return {
        title: `${scanCount} SCANS!! You did it 🎊`,
        body: `A thousand times someone opened ${lockName}. That's not just a story — that's history.`,
      };
  }
};
