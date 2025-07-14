{
  inputs = {
    nixos-hardware.url = "github:NixOS/nixos-hardware";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixos-hardware, flake-utils }: {
    # Simple test flake
  };
}