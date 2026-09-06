{
  description = "prv — Pull-Request like View. Local GitHub-style diff viewer.";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";
  };

  outputs =
    { self, ... }@inputs:

    let
      pname = "prv";

      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSupportedSystem =
        f:
        inputs.nixpkgs.lib.genAttrs supportedSystems (
          system:
          f {
            pkgs = import inputs.nixpkgs { inherit system; };
            inherit system;
          }
        );

      baseVersion = (builtins.fromJSON (builtins.readFile ./package.json)).version;
      version = if self ? rev then baseVersion else "${baseVersion}-dirty";

      # Per-system hash for the node_modules FOD. Regenerate after dependency
      # changes: set the entry to inputs.nixpkgs.lib.fakeHash, run
      #   nix build .#packages.<system>.deps
      # and paste the `got:` sha256 here.
      depsHashes = {
        x86_64-linux = inputs.nixpkgs.lib.fakeHash;
        aarch64-linux = inputs.nixpkgs.lib.fakeHash;
        x86_64-darwin = inputs.nixpkgs.lib.fakeHash;
        aarch64-darwin = inputs.nixpkgs.lib.fakeHash;
      };

      # Bun 1.3.13 fixed the sandbox compile bug; fail eval if older.
      assertBun =
        pkgs:
        assert inputs.nixpkgs.lib.versionAtLeast pkgs.bun.version "1.3.13";
        pkgs.bun;

      # NOTE: extraction trigger — if this derivation grows past ~40-50 lines or a
      # second package appears, move it to ./package.nix and callPackage it.
    in
    {
      packages = forEachSupportedSystem (
        { pkgs, system }:
        let
          bun = assertBun pkgs;

          depsSrc = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./bun.lock
            ];
          };

          deps = pkgs.stdenvNoCC.mkDerivation {
            pname = "${pname}-node-modules";
            inherit version;
            src = depsSrc;
            nativeBuildInputs = [ bun ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              export BUN_INSTALL_CACHE_DIR=$TMPDIR/.bun-cache
              bun install --production --frozen-lockfile --no-progress
            '';
            installPhase = ''
              rm -rf node_modules/.cache
              find node_modules -type l -lname '/nix/store/*' -delete || true
              mkdir -p $out
              cp -R node_modules $out/node_modules
            '';
            dontFixup = true;
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = depsHashes.${system};
          };

          prv = pkgs.stdenvNoCC.mkDerivation {
            inherit pname version;
            src = ./.;
            nativeBuildInputs = [
              bun
              pkgs.makeBinaryWrapper
              pkgs.git
            ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              cp -R ${deps}/node_modules ./node_modules
              chmod -R u+w node_modules
              # KEEP IN SYNC with package.json "build" script (inlined for --define).
              # --splitting keeps the frontend's dynamic imports (the Mermaid
              # renderer) in chunks the binary serves on demand instead of
              # inlining them into the page's main script.
              bun build --compile --splitting --target=bun \
                --define PRV_VERSION='"${version}"' \
                src/cli.ts --outfile dist/prv
              test -s dist/prv
              ./dist/prv --version
            '';
            installPhase = ''
              install -Dm755 dist/prv $out/bin/.prv-wrapped
              makeBinaryWrapper $out/bin/.prv-wrapped $out/bin/prv \
                --prefix PATH : ${
                  pkgs.lib.makeBinPath ([ pkgs.git ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.xdg-utils ])
                }
            '';
            dontFixup = true;
            meta = {
              description = "Pull-Request like View — local GitHub-style diff viewer";
              mainProgram = pname;
              license = pkgs.lib.licenses.mit;
              platforms = supportedSystems;
            };
          };
        in
        {
          inherit deps;
          ${pname} = prv;
          default = prv;
        }
      );

      checks = forEachSupportedSystem (
        { pkgs, system }:
        {
          tests = pkgs.stdenvNoCC.mkDerivation {
            name = "${pname}-tests";
            src = ./.;
            nativeBuildInputs = [
              (assertBun pkgs)
              pkgs.git
            ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              git config --global user.email test@example.com
              git config --global user.name test
              git config --global init.defaultBranch main
              cp -R ${self.packages.${system}.deps}/node_modules ./node_modules
              chmod -R u+w node_modules
              bun test
            '';
            installPhase = "touch $out";
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.nixfmt-rfc-style);

      devShells = forEachSupportedSystem (
        { pkgs, ... }:
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              git
            ];
          };
        }
      );
    };
}
