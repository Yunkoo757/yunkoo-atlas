export class AsyncGeneration {
  private value = 0

  begin(): number {
    this.value += 1
    return this.value
  }

  invalidate(): void {
    this.value += 1
  }

  isCurrent(generation: number): boolean {
    return generation === this.value
  }
}
