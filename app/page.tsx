export default function Home() {
  return (
    <main>
      <h1>Count Me In</h1>
      <p className="lede">
        One-off evenings with people who live nearby: knit a sock, make decorations, tidy a street.
        No organiser, no membership, nothing to commit to.
      </p>
      <h2>How it works</h2>
      <ol>
        <li>Pick an activity and tap Count me in.</li>
        <li>When enough neighbours are in, we suggest a few evenings.</li>
        <li>The first evening to fill up happens, at a checked public place.</li>
      </ol>
      <p><a href="/signin">Sign in</a> to say Count me in.</p>
    </main>
  );
}
