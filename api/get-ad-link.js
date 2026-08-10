const AD_LINKS = [
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80'
];

let queue = [];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function handler(req, res) {
  if (!queue.length) queue = shuffle(AD_LINKS);
  const link = queue.shift();
  res.status(200).json({ url: link });
}
