import Link from 'next/link';
import photoSources from '@/content/photo-sources.json';

export const metadata = {
  title: 'Photo credits · MehmonGo',
  description: 'Sources and licences of the photos used on the MehmonGo guest site.',
};

type PhotoSource = {
  name: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  sourcePage: string | null;
  shareAlike: boolean;
  note: string;
};

const photos = photoSources.photos as PhotoSource[];

/**
 * Credits are rendered from content/photo-sources.json, the same file the image
 * build reads, so the attribution always matches the photos the site serves.
 */
export default function PhotoCreditsPage() {
  return (
    <main className="credits-page">
      <h1>Photo credits</h1>
      <p>
        Destination photos illustrate the places mentioned. They do not promise particular stops, admission or a specific vehicle.
        The photographers do not endorse MehmonGo.
      </p>

      {photos.map((photo) => (
        <article key={photo.name}>
          <h2>{photo.title}</h2>
          <p>
            Photo: {photo.author}.{' '}
            {photo.sourcePage ? (
              <>
                <a href={photo.sourcePage} rel="noreferrer">Original and source information</a>.{' '}
              </>
            ) : null}
            {photo.licenseUrl ? (
              <>
                Licensed under <a href={photo.licenseUrl} rel="noreferrer">{photo.license}</a>.{' '}
              </>
            ) : (
              <>{photo.license}. </>
            )}
            File: <code>{photo.name}.jpg</code>. {photo.note}
            {photo.shareAlike ? ' These adaptations are shared under the same licence.' : ''}
          </p>
        </article>
      ))}

      <article>
        <h2>Brand mark</h2>
        <p>The MehmonGo brand mark is an existing project asset.</p>
      </article>

      <p><Link href="/">Back to MehmonGo</Link></p>
    </main>
  );
}
