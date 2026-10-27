import { PUBLIC_CRAWL_IMAGE_SQL } from './crawl-image-policy';
import {
  CDF_PROFILES,
  CDF_PUBLIC_IMAGE_SQL,
} from '../admin/crawl/service/cdf-profile';
import {
  DRDR_PROFILES,
  DRDR_PUBLIC_IMAGE_SQL,
} from '../admin/crawl/service/drdr-profile';
import {
  WONDERLIVET_PROFILES,
  WONDERLIVET_PUBLIC_IMAGE_SQL,
} from '../admin/crawl/service/wonderlivet-profile';
import { FESTIVAL_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/festival-profile';
import { ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/additional-festival-profile';
import { PRUGIO_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/prugio-profile';
import { CDF_LOW_HIGH_LOW_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/cdf-low-high-low-profile';

describe('public crawl image policy', () => {
  it('publishes the CDF LOW HIGH LOW portrait only through its exact Melon profile branch', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'cdf-low-high-low-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' = 'cdf-low-high-low-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(CDF_LOW_HIGH_LOW_PUBLIC_IMAGE_SQL);
  });
  it('serves the Prugio portrait only from its verified source and origin', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'prugio-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' = 'prugio-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(PRUGIO_PUBLIC_IMAGE_SQL);
  });
  it('publishes additional Seoul portraits only through the verified profile branch', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'additional-festival-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' = 'additional-festival-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL,
    );
  });
  it('serves the three festival profiles only through their reviewed source and image origin pairs', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'festival-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' = 'festival-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(FESTIVAL_PUBLIC_IMAGE_SQL);
  });
  it('serves official gallery portraits only when an enabled gallery owns the same source and festival', () => {
    const branch = PUBLIC_CRAWL_IMAGE_SQL.match(
      /source\."parserConfig"->>'seed' IS DISTINCT FROM 'official-artist-gallery'[\s\S]*?AND image\."originUrl" LIKE 'https:\/\/%'/,
    )?.[0];
    expect(branch).toContain("gallery.kind = 'artist-gallery'");
    expect(branch).toContain('gallery.enabled = true');
    expect(branch).toContain('gallery.url = source.url');
    expect(branch).toContain(
      "gallery.\"parserConfig\"->>'seed' = 'xmf-official-gallery'",
    );
    expect(branch).toContain('source."parserConfig"->>\'festivalSourceUrl\'');
  });

  it('honors a timetable source image opt-out before the verified-image check', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      `source."parserConfig"->>'publicSourceImage' IS DISTINCT FROM 'false'`,
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toMatch(
      /source\.kind = 'timetable'[\s\S]*publicSourceImage[\s\S]*revision\.status = 'verified'/,
    );
  });

  it('limits Wonderlivet images to the official child source and its exact validated image path', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.url = 'https://www.wonderli.vet/lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'festivalSourceUrl' = 'https://www.wonderli.vet/lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toMatch(
      /official-wonderlivet-lineup'[\s\S]*image\."originUrl" =\s*'https:\/\/mcnqglozya2x8j6x\.public\.blob\.vercel-storage\.com' \|\|/,
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toMatch(
      /gallery\.kind = 'artist-gallery'[\s\S]*gallery\.enabled = true[\s\S]*gallery\.url = source\.url/,
    );
  });

  it('limits GMF artist photos to its active official gallery and exact S3 image path', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'official-gmf-lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.url = 'https://www.mintpaper.co.kr/festivals/172/lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'festivalSourceUrl' = 'https://mintpaper.co.kr/festivals/172'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "gallery.\"parserConfig\"->>'seed' = 'gmf-official-lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "'https://mintpaper.s3.ap-northeast-2.amazonaws.com' ||",
    );
  });

  it('publishes CDF photos only from their reviewed profile and image origin', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'cdf-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(CDF_PUBLIC_IMAGE_SQL);
    const clauses = [
      ...CDF_PUBLIC_IMAGE_SQL.matchAll(
        /\(source\.url = '([^']+)' AND source\."parserConfig"->>'artistName' = '([^']+)' AND source\."parserConfig"->>'officialHandle' = '([^']+)' AND image\."originUrl" ~\* '([^']+)'\)/g,
      ),
    ];
    expect(clauses).toHaveLength(Object.keys(CDF_PROFILES).length);
    for (const [
      ,
      pageUrl,
      artistName,
      officialHandle,
      originPattern,
    ] of clauses) {
      const profile = CDF_PROFILES[pageUrl];
      expect(artistName).toBe(profile.artistName);
      expect(officialHandle).toBe(profile.officialHandle);
      const allowed = new RegExp(originPattern, 'i');
      const example =
        'https://' +
        profile.imageHost +
        (profile.rule === 'kardi'
          ? '/_next/static/media/group.abc.webp'
          : profile.rule === 'onewe'
            ? '/image.fanicon.net/cms/1787193539269_IU8r7cOZH6.jpg'
            : profile.rule === 'axmxp' || profile.rule === 'ftisland'
              ? '/files/2026/08/06/abcdef.jpg'
              : profile.rule === 'solutions'
                ? '/thumbnails/uploadedFiles/123/default/image_123_2500.jpg'
                : profile.rule === 'idiotape'
                  ? '/wp-content/uploads/2026/08/profile.jpg'
                  : '/drmvsn/wp-content/uploads/2026/08/profile.jpg');
      expect(allowed.test(example)).toBe(true);
      expect(
        allowed.test(example.replace(profile.imageHost, 'evil.example')),
      ).toBe(false);
      expect(allowed.test(example + '?volatile=1')).toBe(false);
    }
  });

  it('publishes DRDR portraits only for verified post, festival and artist bindings', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'drdr-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(DRDR_PUBLIC_IMAGE_SQL);
    for (const [page, profile] of Object.entries(DRDR_PROFILES)) {
      expect(DRDR_PUBLIC_IMAGE_SQL).toContain(`source.url = '${page}'`);
      expect(DRDR_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'festivalSourceUrl' = '${profile.festivalSourceUrl}'`,
      );
      expect(DRDR_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'artistName' = '${profile.artistName}'`,
      );
    }
    expect(DRDR_PUBLIC_IMAGE_SQL).toContain(
      'image."originUrl" ~* \'^https://drdr[.]ac/wordpress/wp-content/uploads/',
    );
  });

  it('limits Wonderlivet profile portraits to the six reviewed sources and origins', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'wonderlivet-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(WONDERLIVET_PUBLIC_IMAGE_SQL);
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'festivalSourceUrl' = 'https://www.wonderli.vet/lineup'",
    );
    for (const [page, profile] of Object.entries(WONDERLIVET_PROFILES)) {
      expect(WONDERLIVET_PUBLIC_IMAGE_SQL).toContain(`source.url = '${page}'`);
      expect(WONDERLIVET_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'artistName' = '${profile.artistName}'`,
      );
    }
  });
});
