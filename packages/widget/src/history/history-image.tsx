import type { HistoryImage as RecordedImage } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";

import { LensProtocolError } from "@/anywidget/error";
import { useObjectUrl } from "@/ui/use-object-url";

import { historyStyles } from "./history-list.styles";

type HistoryImageProps = {
  image: RecordedImage;
  title: string;
  load: (sha256: string) => Promise<Uint8Array<ArrayBuffer>>;
};

/** Show the annotated PNG the analyst saw, read from the notebook's record. */
export function HistoryImage({ image, title, load }: HistoryImageProps) {
  const current = useObjectUrl(image.sha256, () => load(image.sha256));
  if (current && "error" in current) {
    const missing =
      current.error instanceof LensProtocolError &&
      current.error.code === "history_image_not_found";
    return (
      <p
        {...stylex.props(historyStyles.meta)}
        data-marimo-lens-history-image={missing ? "missing" : "unavailable"}
      >
        {missing
          ? `The record no longer holds the image ${title} showed.`
          : `The image ${title} showed could not load. Collapse and expand the entry to try again.`}
      </p>
    );
  }
  return (
    <figure {...stylex.props(historyStyles.figure)} data-marimo-lens-history-image>
      {current ? (
        <img
          {...stylex.props(historyStyles.image)}
          src={current.url}
          width={image.width}
          height={image.height}
          alt={`${title} as the analyst saw it`}
        />
      ) : (
        <div
          {...stylex.props(historyStyles.imagePlaceholder(`${image.width} / ${image.height}`))}
          aria-hidden="true"
        />
      )}
      {image.outdated ? (
        <figcaption {...stylex.props(historyStyles.meta)}>
          Taken before the selection moved.
        </figcaption>
      ) : null}
    </figure>
  );
}
