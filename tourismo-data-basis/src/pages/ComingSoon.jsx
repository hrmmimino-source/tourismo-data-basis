export default function ComingSoon({ title, text, step }) {
  return (
    <div className="page narrow">
      <h1>{title}</h1>
      <div className="card empty">
        <div className="badge soon-badge">Coming in step {step}</div>
        <p>{text}</p>
      </div>
    </div>
  );
}
