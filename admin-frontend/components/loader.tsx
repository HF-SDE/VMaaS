import "./loader.css";
export default function Loader() {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-4">
      <div className="snippet" data-title="dot-bricks">
        <div className="stage ">
          <div className="dot-bricks "></div>
        </div>
      </div>
      <p className="font-bold">Indlæser...</p>
    </div>
  );
}
