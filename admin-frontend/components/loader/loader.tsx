import "./loader.css"
export default function Loader({ text = "Indlæser..." }: { text?: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-4">
      <div className="snippet" data-title="dot-bricks">
        <div className="stage">
          <div className="dot-bricks"></div>
        </div>
      </div>
      <p className="font-bold">{text}</p>
    </div>
  )
}
