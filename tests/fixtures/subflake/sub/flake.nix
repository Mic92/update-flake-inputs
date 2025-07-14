{
  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixos-hardware.url = "github:NixOS/nixos-hardware";
  };

  outputs = { self, flake-utils, nixos-hardware }: {
    # Subflake
  };
}