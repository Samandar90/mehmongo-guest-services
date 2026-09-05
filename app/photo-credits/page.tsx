import Link from 'next/link';

export const metadata = {
  title: 'Photo credits · MehmonGo',
  description: 'Sources and licences of the photos used on the MehmonGo guest site.',
};

type Credit = {
  title: string;
  body: React.ReactNode;
};

const credits: Credit[] = [
  {
    title: 'Chorsu Bazaar, Tashkent',
    body: (
      <>
        Photo: Chris Shervey.{' '}
        <a href="https://commons.wikimedia.org/wiki/File:Chorsu_Bazaar,_Tashkent.jpg">Original and source information</a>.
        Licensed under <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>. File: <code>tashkent-chorsu.jpg</code>.
        Downloaded unchanged, then resized and converted to WebP and JPEG for this website; the page may crop its display to fit the layout.
      </>
    ),
  },
  {
    title: 'Charvak Reservoir',
    body: (
      <>
        Photo: J.Doniyorovich.{' '}
        <a href="https://commons.wikimedia.org/wiki/File:Charvak_Reservoir.jpg">Original and source information</a>.
        Available under <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>. File: <code>charvak.jpg</code>.
        Downloaded unchanged, then resized and converted to WebP and JPEG for this website; the page may crop its display to fit the layout.
      </>
    ),
  },
  {
    title: 'Registan, Samarkand',
    body: (
      <>
        Photo: Euyasik.{' '}
        <a href="https://commons.wikimedia.org/wiki/File:Registan_Samarkand.jpg">Original and source information</a>.
        Used under <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>. File: <code>samarkand-registan.jpg</code>.
        Downloaded unchanged, then resized and converted to WebP and JPEG for this website; the page may crop its display to fit the layout.
        These adaptations are shared under the same licence. Sightseeing and admission are not included in the intercity transfer.
      </>
    ),
  },
  {
    title: 'Vehicle examples and brand mark',
    body: (
      <>
        Vehicle pictures were supplied in the service provider&apos;s catalogue and are used as illustrative examples:{' '}
        <code>airport-sedan.jpg</code> and <code>family-minivan.jpg</code>. They are not offered under a Creative Commons licence.
        The assigned vehicle, model and capacity are confirmed separately. The MehmonGo brand mark is an existing project asset.
      </>
    ),
  },
];

export default function PhotoCreditsPage() {
  return (
    <main className="credits-page">
      <h1>Photo credits</h1>
      <p>
        Destination photos illustrate the places mentioned. They do not promise particular stops, admission or a specific vehicle.
        The photographers do not endorse MehmonGo.
      </p>
      {credits.map((credit) => (
        <article key={credit.title}>
          <h2>{credit.title}</h2>
          <p>{credit.body}</p>
        </article>
      ))}
      <p><Link href="/">Back to MehmonGo</Link></p>
    </main>
  );
}
