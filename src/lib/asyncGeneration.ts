export class AsyncGeneration {
  private value = 0

  begin(): number {
    this.value += 1
    return this.value
  }

  invalidate(): void {
    this.value += 1
  }

  capture(): () => boolean {
    const generation = this.value
    return () => this.isCurrent(generation)
  }

  isCurrent(generation: number): boolean {
    return generation === this.value
  }
}
