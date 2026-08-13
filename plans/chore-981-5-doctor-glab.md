# chore(#1284 / #981 段階5): doctor と設定を GitLab 対応に追随させる

段階4 が全部入ったので、doctor とドキュメントをそれに合わせる。#981 の最後。

## 決めたこと: `gh` が主、`glab` は optional

doctor の型は `required: true | false` の2値で、「gh か glab のどちらかがあればよい」を書けない。
`role` のような抽象を入れる案もあったが、**オーナー判断で `gh` は必須のまま、`glab` を optional**
とした。github.com がこのアプリの主戦場で、**GitLab を使わない人に「足りない」と言わない**方が
正しいという判断。

結果、doctor に概念は1つも増えない（行が1つ増えるだけ）。

## ドキュメントで見つかった「もう嘘」

段階4a の時点で書いた記述が、4c / 4b が入った今は**事実と違って**いた。

| 場所 | 何が嘘だったか |
| --- | --- |
| `README.md` の `prRepos` | 「**only github.com is read today**」— 今は GitLab も読む |
| `README.md` の設定説明 | 「via your server-side `gh` login」— `glab` も使う |
| `docs/guide/{en,ja}/github.md` | 「**github.com is the only forge this reads today**」 |

4.1.0 のリリースガイドには正しく書いたが、**常設のページは追随していなかった**。日付入りの
スナップショットは古くてよいが、常設ページが古いのは別の話。

あわせて `glab` を **README と日英ガイドの「一緒に入れておくコマンド」表**に追加した
（4.1.0 のページにはあったが、常設の表には無かった）。

## CI ドットの限界を常設ガイドにも書いた

「GitLab の行の CI ドットはたいてい空」は 4.1.0 のページにしか無かった。**これは仕様として残る**
ので、常設の GitHub 連携ガイドにも書いた。あわせて「**1 ブランチだけ見るセルは読むので、
コックピットの pill は正確**」も書いた — 2つの判断が違う理由が分かるように。

## 検証

`PATH_TOOLS` にテストは無い（1行の追加なので新規に作らない）。**doctor を実際に走らせた**:

```
glab あり: ✓ glab — the same, for gitlab.com projects
glab なし: ○ glab — optional (the same, for gitlab.com projects)
              → brew install glab  (then: glab auth login)
```
