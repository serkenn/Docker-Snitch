# Docker Snitch

Little Snitch にインスパイアされた Docker コンテナ用ネットワークモニター。Web GUI を通じて、すべての Docker コンテナのネットワーク通信をキャプチャ・可視化・制御します。

## 機能

- **リアルタイム接続監視** -- すべてのコンテナの TCP/UDP 接続をリアルタイムで表示
- **コンテナ単位のフィルタリング** -- クリックで単一コンテナ、Cmd/Ctrl+クリックで複数コンテナを選択して合計トラフィックを表示
- **ワールドマップ** -- OpenStreetMap / Leaflet によるダークマップ上でのトラフィック発信元・送信先の地理的可視化（アニメーション付きアーク線）
- **GeoIP 解決** -- すべてのリモート IP に対して国・都市・ISP・ASN・緯度経度を自動解決（ip-api.com 経由）
- **トラフィック分類** -- 接続を Tailnet、GCP、Mullvad VPN、Cloudflare、AWS、Azure、Hetzner、OVH、Internet に自動分類
- **ネットワークマップ** -- トラフィックカテゴリ別にグループ化された Mermaid トポロジー図（帯域幅内訳付き）
- **ファイアウォールルール** -- コンテナ・リモートホスト・ポート・プロトコル単位で許可/ブロックルールを作成
- **パッシブ DNS** -- DNS レスポンスをスニッフィングして IP アドレスを自動的にドメイン名に解決
- **トラフィックチャート** -- Recharts によるコンテナ単位の帯域幅グラフ
- **WebSocket ライブ更新** -- パケットが流れるたびにダッシュボードがリアルタイムで更新

## アーキテクチャ

```
┌────────────┐     ┌─────────────────────────────────────┐
│  Frontend   │────>│  Monitor (Go)                       │
│  React/Vite │ WS  │  ┌─────────┐  ┌──────────────────┐ │
│  port 9080  │────>│  │ REST API │  │ NFQUEUE Capture  │ │
└────────────┘     │  └─────────┘  └──────────────────┘ │
                    │  ┌─────────┐  ┌──────────────────┐ │
                    │  │ ルール  │  │ コンテナ解決      │ │
                    │  │ エンジン │  │ (Docker API)      │ │
                    │  └─────────┘  └──────────────────┘ │
                    │  ┌─────────┐  ┌──────────────────┐ │
                    │  │ SQLite  │  │ パッシブ DNS      │ │
                    │  └─────────┘  └──────────────────┘ │
                    └─────────────────────────────────────┘
                              │
                    iptables DOCKER-USER チェーン
                              │
                    ┌─────────────────────┐
                    │  Docker Bridge Net   │
                    │  ┌───┐ ┌───┐ ┌───┐  │
                    │  │ A │ │ B │ │ C │  │
                    │  └───┘ └───┘ └───┘  │
                    └─────────────────────┘
```

```
                    ┌──────────────────┐
                    │  GeoIP Resolver  │
                    │  (ip-api.com)    │
                    └──────────────────┘
```

### 仕組み

1. monitor コンテナが `network_mode: host` と `NET_ADMIN` 権限で起動
2. iptables の `DOCKER-USER` チェーンにルールを挿入: `iptables -I DOCKER-USER -j NFQUEUE --queue-num 0 --queue-bypass`
3. Docker ブリッジを通過するすべてのパケットが NFQUEUE（netlink）経由で Go プログラムに配信
4. プログラムが各パケットを解析し、Docker API で送信元/送信先コンテナを特定、ルールを照合して ACCEPT または DROP を発行
5. 接続イベントが WebSocket 経由で Web ダッシュボードにブロードキャスト
6. シャットダウン時に iptables ルールは自動的にクリーンアップ。`--queue-bypass` により、monitor がクラッシュしてもトラフィックは正常に流れる

## クイックスタート

### 前提条件

- Docker および Docker Compose
- Docker Desktop が起動中（または Linux 上の Docker デーモン）

### 実行

```bash
docker compose up --build
```

ブラウザで **http://localhost:9080** を開きます。

### サンプルコンテナでテスト

```bash
# トラフィックを生成するためのコンテナを起動
docker run -d --name nginx-test nginx
docker run -d --name redis-test redis
docker run -d --name curl-test curlimages/curl sleep 3600

# トラフィックを発生させる
docker exec curl-test curl -s https://example.com
docker exec curl-test curl -s https://api.github.com
```

## Web GUI

### 接続タブ (Connections)

すべてのアクティブな接続をリアルタイムで表示:

| カラム    | 説明                                      |
| --------- | ----------------------------------------- |
| Container | 送信元/送信先のコンテナ名                 |
| Dir       | アウトバウンド (↑) またはインバウンド (↓) |
| Remote    | ドメイン名または IP アドレス              |
| Port      | リモートポート番号                        |
| Proto     | TCP / UDP                                 |
| Location  | 国旗、都市、国名                          |
| ISP / Org | インターネットサービスプロバイダまたは組織 |
| Type      | カテゴリバッジ（Tailnet、GCP、Mullvad、AWS、Cloudflare 等）|
| Action    | 許可 (緑) またはブロック (赤)             |
| Sent/Recv | 転送バイト数                              |
| Duration  | 接続の継続時間                            |

任意の接続の **Block** ボタンをクリックしてブロックルールを作成できます。

### コンテナサイドバー

- **クリック** でそのコンテナの接続のみをフィルタ
- **Cmd/Ctrl+クリック** で複数コンテナを選択し、合計トラフィックを表示
- 選択サマリーに選択中コンテナの合計接続数と帯域幅を表示
- 緑のドット = アクティブなトラフィックがあるコンテナ

### ワールドマップタブ (World Map)

Leaflet を使用した OpenStreetMap ベースの地理的可視化:
- ダークタイルレイヤー（CARTO Dark Matter）による視認性の高い表示
- サーバーマーカー（青）でサーバーの位置を表示
- トラフィックカテゴリ別に色分けされたリモートエンドポイントマーカー（トラフィック量に応じたサイズ）
- トラフィックの方向と帯域幅を示す曲線アーク
- ブロックされた接続は赤い破線で表示
- ドメイン、国、ISP、カテゴリ、トラフィック詳細を表示するインタラクティブなポップアップ
- すべてのエンドポイントを表示するよう自動フィット
- 接続数付きカテゴリ凡例

### ネットワークマップタブ (Network Map)

Mermaid によるインタラクティブなダイアグラムを表示:
- カテゴリ別（Tailnet、GCP、Mullvad、AWS 等）にグループ化されたコンテナとリモートエンドポイント
- カテゴリ別トラフィック帯域幅の内訳カード
- 各エッジのトラフィック量
- ブロックされた接続は赤でハイライト
- コンテナ選択フィルタに連動

展開可能な「Mermaid Source」セクションで生のダイアグラムコードを確認できます。

### ルールタブ (Rules)

ファイアウォールルールの作成・編集・切替・削除:

| フィールド  | 値                                       |
| ----------- | ---------------------------------------- |
| Container   | コンテナ名 または `*`（全コンテナ）      |
| Direction   | outbound / inbound / both                |
| Remote Host | IP、CIDR（例: `10.0.0.0/8`）、または `*` |
| Remote Port | ポート番号 または `0`（全ポート）        |
| Protocol    | tcp / udp / `*`                          |
| Action      | allow / block                            |
| Priority    | 数値が小さいほど優先度が高い             |

ルールは優先度順に評価され、最初にマッチしたルールが適用されます。デフォルトのアクションは **allow**（フェイルオープン）です。

## 設定

monitor コンテナの環境変数:

| 変数                    | デフォルト値      | 説明                                     |
| ----------------------- | ----------------- | ---------------------------------------- |
| `SNITCH_DB_PATH`        | `/data/snitch.db` | SQLite データベースのパス                |
| `SNITCH_API_PORT`       | `9645`            | API サーバーのポート                     |
| `SNITCH_DEFAULT_ACTION` | `allow`           | ルールにマッチしない場合のデフォルト判定 |
| `SNITCH_QUEUE_NUM`      | `0`               | NFQUEUE のキュー番号                     |

## プロジェクト構成

```
├── docker-compose.yml
├── monitor/                     # Go バックエンド
│   ├── Dockerfile
│   ├── cmd/monitor/main.go      # エントリーポイント
│   └── internal/
│       ├── capture/             # NFQUEUE パケットキャプチャ
│       ├── containers/          # Docker API コンテナ解決
│       ├── conntrack/           # DNS キャッシュ + GeoIP リゾルバ
│       ├── rules/               # ルールエンジン + SQLite ストア
│       ├── api/                 # REST API + WebSocket ハブ
│       └── db/                  # データベース初期化 + マイグレーション
└── frontend/                    # React Web GUI
    ├── Dockerfile
    └── src/
        ├── components/
        │   ├── ConnectionTable  # リアルタイム接続テーブル
        │   ├── ContainerList    # 複数選択対応コンテナサイドバー
        │   ├── WorldMap         # OpenStreetMap 地理的可視化
        │   ├── NetworkMap       # Mermaid トポロジーダイアグラム
        │   ├── TrafficChart     # 帯域幅チャート
        │   ├── RuleList         # ルール管理
        │   └── RuleEditor       # ルール作成/編集モーダル
        ├── api/                 # REST + WebSocket クライアント
        └── types/               # TypeScript 型定義
```

## 制限事項

- IPv4 のみ対応（IPv6 サポートは予定）
- Docker ブリッジネットワークのみ監視（host や macvlan は非対応）
- macOS の Docker Desktop では、`network_mode: host` は macOS ホストではなく Linux VM のホストを意味します。コンテナトラフィックの監視には問題なく動作します
- NFQUEUE にはスループットの上限があり、10Gbps 以上のトラフィックには不向きです

## ライセンス

MIT
